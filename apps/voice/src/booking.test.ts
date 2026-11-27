import { describe, expect, it } from "vitest";
import { BookingFlow, goodbyeFor, isBookingIntent, isClosing, todayNote, type Booking } from "./booking";

// Tuesday 24 November 2026, 10:00 in India (04:30 UTC).
const NOW = () => new Date(Date.UTC(2026, 10, 24, 4, 30));

function flow(language: "en" | "hi" | "en-hi") {
  const booked: Booking[] = [];
  const f = new BookingFlow({ language, now: NOW, onBooked: (b) => booked.push(b) });
  return { f, booked };
}

describe("booking: the user's three flows", () => {
  it("English: name, then day, then time, one confirmation", () => {
    const { f, booked } = flow("en");
    expect(f.handle("What does the Business plan cost?")).toBeNull(); // not a booking: the model answers
    expect(f.handle("I'd like to schedule a call")).toBe("Sure, I can arrange that. May I have your name?");
    expect(f.handle("My name is Karan.")).toBe("Thanks, Karan. Which day suits you?");
    expect(f.handle("24th November, Tuesday")).toBe("And what time on Tuesday, 24 November?");
    expect(f.handle("1 PM")).toBe("Done, Karan: Tuesday, 24 November at 1 PM. The team will confirm it with a meeting link.");
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ name: "Karan", date: "2026-11-24", time: "13:00" });
    expect(booked[0]!.at.toISOString()).toBe("2026-11-24T07:30:00.000Z");
    // After the confirmation it stops asking: unrelated lines go to the model.
    expect(f.handle("Does it include call recording?")).toBeNull();
    expect(f.modelNote()).toContain("callback already booked");
  });

  it("Hindi: understands मंगलवार, 24 नवंबर and दोपहर एक बजे", () => {
    const { f, booked } = flow("hi");
    expect(f.handle("मुझे एक कॉल शेड्यूल करनी है")).toBe("जी ज़रूर, मैं arrange कर देता हूँ। आपका नाम क्या है?");
    expect(f.handle("मेरा नाम करन है")).toBe("धन्यवाद करन जी। आपको किस दिन call चाहिए?");
    expect(f.handle("मंगलवार 24 नवंबर")).toBe("मंगलवार 24 नवंबर को किस समय?");
    expect(f.handle("दोपहर एक बजे")).toBe("ठीक है करन जी, मंगलवार 24 नवंबर, दोपहर 1 बजे। Team meeting link के साथ confirm करेगी।");
    expect(booked[0]).toMatchObject({ name: "करन", date: "2026-11-24", time: "13:00" });
  });

  it("Hinglish: one line with everything, and the STT slip 'एक बज़ेट'", () => {
    const { f, booked } = flow("en-hi");
    const reply = f.handle("Mujhe demo chahiye, mera naam Karan hai, 24 November Tuesday ko एक बज़ेट");
    expect(reply).toBe("ठीक है Karan जी, Tuesday 24 November, 1 PM। Team meeting link के साथ confirm करेगी।");
    expect(booked[0]).toMatchObject({ name: "Karan", date: "2026-11-24", time: "13:00" });
  });
});

describe("booking: dates and times", () => {
  it("resolves today, tomorrow and weekdays against today in India", () => {
    const { f, booked } = flow("en");
    f.handle("Can I book a demo for tomorrow at 4 pm? My name is Asha.");
    expect(booked[0]).toMatchObject({ date: "2026-11-25", time: "16:00" });
    const g = flow("hi");
    g.f.handle("कल शाम 5 बजे डेमो चाहिए, मेरा नाम रवि है");
    expect(g.booked[0]).toMatchObject({ date: "2026-11-25", time: "17:00" });
    const h = flow("en-hi");
    h.f.handle("Friday ko saade chaar baje call karwa do, mera naam Meera hai");
    expect(h.booked[0]).toMatchObject({ date: "2026-11-27", time: "16:30" });
  });

  it("asks once when the weekday and the date disagree", () => {
    const { f, booked } = flow("en");
    f.handle("Schedule a call for Karan");
    const q = f.handle("Wednesday 24 November");
    expect(q).toContain("24 November is a Tuesday");
    expect(f.handle("yes")).toBe("And what time on Tuesday, 24 November?");
    f.handle("at 1");
    expect(booked[0]).toMatchObject({ date: "2026-11-24", time: "13:00" });
  });

  it("reads the dates speech-to-text misspells ('चोबीस नवंबर')", () => {
    const { f, booked } = flow("hi");
    f.handle("मुझे डेमो चाहिए, मेरा नाम करन है");
    f.handle("बुधवार, पचीस नवंबर");
    f.handle("शाम पांच बजे");
    expect(booked[0]).toMatchObject({ date: "2026-11-25", time: "17:00" });
  });

  it("refuses a time that has already passed today", () => {
    const { f } = flow("en");
    f.handle("Book a call for Karan today");
    expect(f.handle("9 am")).toBe("That time has already passed today. What time would suit you?");
  });

  it("takes 'अभी' as about 15 minutes from now, on a quarter hour, today", () => {
    const { f, booked } = flow("hi");
    f.handle("अभी कॉल करवा दीजिए, मेरा नाम करन है");
    expect(booked[0]).toMatchObject({ date: "2026-11-24", time: "10:15" });
  });

  it("keeps the name exactly as first heard", () => {
    const { f } = flow("hi");
    f.handle("डेमो चाहिए, मेरा नाम करन है");
    f.handle("मेरा नाम करण है");
    expect(f.callerName).toBe("करन");
  });

  it("lets a caller cancel, and lets the model answer their own question mid-booking", () => {
    const { f } = flow("en");
    f.handle("I want a demo");
    expect(f.handle("What does the Starter plan include?")).toBeNull();
    expect(f.pendingQuestion("ok")).toBe("Sure, I can arrange that. May I have your name?");
    expect(f.handle("no thanks")).toContain("won't book");
    expect(f.active).toBe(false);
  });

  it("updates a confirmed booking when the caller changes the time", () => {
    const { f, booked } = flow("en");
    f.handle("Schedule a call for Karan tomorrow at 11 am");
    expect(f.handle("Actually make it 2 pm")).toBe("Done, Karan: Wednesday, 25 November at 2 PM. The team will confirm it with a meeting link.");
    expect(booked.map((b) => [b.time, b.changed])).toEqual([["11:00", false], ["14:00", true]]);
  });
});

describe("booking: intent, goodbye and today's note", () => {
  it("does not mistake ordinary questions for a booking", () => {
    for (const t of ["Do you record calls?", "What does the Business plan cost?", "क्या कॉल रिकॉर्ड होती है?", "Is call tracking included?"]) expect(isBookingIntent(t)).toBe(false);
    for (const t of ["Can I get a demo?", "please call me back", "मुझे डेमो चाहिए", "call karwa do kal"]) expect(isBookingIntent(t)).toBe(true);
    // How speech-to-text actually wrote these in the 24 November test calls.
    for (const t of ["मुझे एक कॉल शेडिूल करनी है।", "मुझे एक कॉल शेड्यूल करनी है", "मुझे एक कॉल करनी है"]) expect(isBookingIntent(t)).toBe(true);
    for (const t of ["क्या कॉल रिकॉर्ड होती है?", "कॉल रिकॉर्ड करते हैं क्या?"]) expect(isBookingIntent(t)).toBe(false);
    for (const t of ["Does the Business plan include meeting transcripts?", "क्या मीटिंग का transcript मिलता है?"]) expect(isBookingIntent(t)).toBe(false);
    for (const t of ["I want to schedule a meeting", "I need a meeting with your team", "मीटिंग चाहिए", "meeting fix karo kal"]) expect(isBookingIntent(t)).toBe(true);
  });

  it("says one short goodbye in the caller's language", () => {
    for (const t of ["thank you", "Okay, thanks. Bye!", "धन्यवाद", "ठीक है, धन्यवाद", "shukriya ji", "take care"]) expect(isClosing(t)).toBe(true);
    for (const t of ["thanks, what about the Starter plan?", "धन्यवाद, और Starter plan?"]) expect(isClosing(t)).toBe(false);
    expect(goodbyeFor("धन्यवाद", "en-hi")).toBe("धन्यवाद! हमारी team जल्दी ही आपको call करेगी। आपका दिन शुभ हो।");
    expect(goodbyeFor("thank you", "en")).toBe("You're welcome! Our team will call you soon to take this forward. Have a great day.");
  });

  it("gives the model today's date in India", () => {
    expect(todayNote(NOW())).toBe("today: Tuesday, 24 November 2026, 10 AM India time");
  });
});
