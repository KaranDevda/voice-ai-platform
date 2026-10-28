import { describe, expect, it } from "vitest";
import { commitsToConnect, detectHandoff, isAgreement, offeredHandoff } from "./handoff";

const ALL = { person: true, complaint: true, payment: true };
const reason = (t: string, e = ALL) => detectHandoff(t, e);

describe("detectHandoff", () => {
  it("hands over when the caller asks for a person, in English, Hindi and Hinglish", () => {
    for (const t of ["Can I speak to a real person?", "I want to talk to a human", "Please connect me to an agent", "transfer me to your manager", "I need a real person", "put me through to someone",
      "मुझे किसी इंसान से बात करनी है", "एजेंट से बात करवाइए", "मैनेजर से जोड़ दीजिए", "agent se baat karwao", "mujhe insaan se baat karni hai", "manager ko connect karo", "baat karwa do"]) expect(reason(t), t).toBe("person");
  });
  it("hands over for a complaint or a payment problem, and the order is person, complaint, payment", () => {
    expect(reason("I want to make a complaint")).toBe("complaint");
    expect(reason("this is a fraud, you cheated me")).toBe("complaint");
    expect(reason("मुझे शिकायत करनी है")).toBe("complaint");
    expect(reason("mujhe shikayat karni hai")).toBe("complaint");
    expect(reason("I want a refund")).toBe("payment");
    expect(reason("my money was deducted twice")).toBe("payment");
    expect(reason("पैसे कट गए हैं, रिफंड चाहिए")).toBe("payment");
    expect(reason("mujhe refund chahiye")).toBe("payment");
    expect(reason("where is my refund")).toBe("payment");
    expect(reason("I want a refund and to speak to a manager")).toBe("person");
  });
  it("does not hand over for ordinary questions that only contain the same words", () => {
    for (const t of ["How do I connect an agent's phone to the app?", "What is the price of the Business plan?", "Do agents get their own login?", "Tell me about call tracking for agent mobile phones",
      "Is there a payment option for annual plans?", "What is your refund policy?", "How many users can I add?", "बिज़नेस प्लान की कीमत क्या है?", "क्या आप कॉल रिकॉर्ड करते हैं?", "okay thanks", ""]) expect(reason(t), t).toBeNull();
  });
  it("respects the organisation's switches", () => {
    expect(reason("I want a refund", { ...ALL, payment: false })).toBeNull();
    expect(reason("I have a complaint", { ...ALL, complaint: false })).toBeNull();
    expect(reason("speak to a human", { ...ALL, person: false })).toBeNull();
  });
});

describe("Hindi spellings of 'a person'", () => {
  const on = { person: true, complaint: true, payment: true };
  it("hands over for each spelling Whisper may write", () => {
    for (const q of ["क्या मैं किसी इंसान से बात कर सकता हूँ", "क्या मैं किसी इनसान से बात कर सकता हूं।", "मुझे किसी इन्सान से बात करनी है", "किसी व्यक्ति से बात करवाइए"]) expect(detectHandoff(q, on)).toBe("person");
  });
  it("does not hand over for an ordinary question", () => {
    expect(detectHandoff("प्लान की कीमत क्या है", on)).toBeNull();
  });
});

describe("offeredHandoff and isAgreement", () => {
  it("recognise an offer to connect a person, in Hindi and English", () => {
    expect(offeredHandoff("इसकी जानकारी अभी मेरे पास नहीं है। अगर आप चाहें, तो मैं आपको अपने साथी से जोड़ देता हूँ।")).toBe(true);
    expect(offeredHandoff("I do not have that. I can connect you with a person.")).toBe(true);
    expect(offeredHandoff("जी बिल्कुल। Starter प्लान एक हज़ार नौ सौ निन्यानवे रुपये प्रति माह का है।")).toBe(false);
    expect(offeredHandoff(undefined)).toBe(false);
  });
  it("hear a short yes, even garbled, and ignore a no or a new question", () => {
    for (const yes of ["ठीक है जोड दीजाँ", "हाँ जी", "हां कर दीजिए", "yes please", "okay connect me", "haan theek hai"]) expect(isAgreement(yes), yes).toBe(true);
    for (const no of ["नहीं, रहने दीजिए", "no thanks", "अभी नहीं", "हाँ लेकिन पहले बताइए कि बिज़नेस प्लान में कितने यूज़र मिलते हैं", ""]) expect(isAgreement(no), no).toBe(false);
  });
});

describe("Hindi matching without the dot under letters", () => {
  it("still hears a request for a person when the recogniser drops the nukta", () => {
    expect(reason("ठीक है आप मुझे किसी इनसान से जोड दीजिये")).toBe("person");
    expect(reason("ठीक है आप मुझे किसी इनसान से जोड़ दीजिये")).toBe("person");
    expect(offeredHandoff("अगर आप चाहें, तो मैं आपको अपने साथी से जोड देता हूँ।")).toBe(true);
    expect(isAgreement("ठीक है जोड दीजाँ")).toBe(true);
  });
});

describe("commitsToConnect", () => {
  it("is true only when the AI says it is connecting the caller now", () => {
    expect(commitsToConnect("मैं अभी आपको अपने साथी से जोड़ देता हूँ।")).toBe(true);
    expect(commitsToConnect("मैं अभी आपको अपने साथी से जोड देती हूँ।")).toBe(true);
    expect(commitsToConnect("मैं आपको अपने साथी से जोड़ देती हूँ।")).toBe(true);
    expect(commitsToConnect("Let me connect you with a colleague.")).toBe(true);
    expect(commitsToConnect("अगर आप चाहें, तो मैं आपको अपने साथी से जोड़ देता हूँ।")).toBe(false);
    expect(commitsToConnect("I can connect you with a person if you like.")).toBe(false);
    expect(commitsToConnect("जी बिल्कुल। Starter प्लान एक हज़ार नौ सौ निन्यानवे रुपये का है।")).toBe(false);
  });
});
