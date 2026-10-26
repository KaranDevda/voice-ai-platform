import { describe, expect, it } from "vitest";
import { forSpeech, forVoice, hindiNumberWords, spellOutHindiNumbers } from "./speech-text";

describe("forSpeech", () => {
  it("removes markdown, emoji and links", () => {
    expect(forSpeech("**Sure!** The plan is *great* \u{1F60A}. See https://bizfy.example/plans for more.")).toBe("Sure! The plan is great . See for more.");
    expect(forSpeech("[our pricing page](https://x.example) has details")).toBe("our pricing page has details");
  });
  it("drops bullets and code", () => {
    expect(forSpeech("- first thing\n- second thing")).toBe("first thing second thing");
    expect(forSpeech("Run ```npm install``` now")).toBe("Run now");
  });
  it("keeps Hindi text intact, including bracketed Hindi", () => {
    expect(forSpeech("जी हाँ। प्लान की कीमत ४९९९ रुपये है।")).toBe("जी हाँ। प्लान की कीमत ४९९९ रुपये है।");
    expect(forSpeech("बिज़नेस प्लान (मासिक) सस्ता है")).toContain("(मासिक)");
  });
  it("leaves ordinary sentences alone", () => {
    expect(forSpeech("The business plan costs 4,999 rupees per month.")).toBe("The business plan costs 4,999 rupees per month.");
  });
});

describe("Hindi numbers", () => {
  it("spells out whole numbers with the Indian groups", () => {
    const cases: Array<[number, string]> = [[0, "शून्य"], [7, "सात"], [21, "इक्कीस"], [99, "निन्यानवे"], [100, "एक सौ"], [1999, "एक हज़ार नौ सौ निन्यानवे"], [4999, "चार हज़ार नौ सौ निन्यानवे"],
      [10000, "दस हज़ार"], [100000, "एक लाख"], [250000, "दो लाख पचास हज़ार"], [12345678, "एक करोड़ तेईस लाख पैंतालीस हज़ार छह सौ अठहत्तर"]];
    for (const [n, words] of cases) expect(hindiNumberWords(n)).toBe(words);
  });
  it("has a distinct word for every number from 0 to 99", () => {
    const all = Array.from({ length: 100 }, (_, i) => hindiNumberWords(i));
    expect(new Set(all).size).toBe(100);
    expect(all.every((w) => /^[\u0900-\u097F]+$/.test(w))).toBe(true);
  });
  it("replaces digits, commas, rupee signs and percentages inside Hindi sentences", () => {
    expect(spellOutHindiNumbers("बिजनेस प्लान की कीमत 4,999 रुपये प्रति माह है।")).toBe("बिजनेस प्लान की कीमत चार हज़ार नौ सौ निन्यानवे रुपये प्रति माह है।");
    expect(spellOutHindiNumbers("कीमत ₹1,999 है")).toBe("कीमत एक हज़ार नौ सौ निन्यानवे रुपये है");
    expect(spellOutHindiNumbers("सालाना लेने पर 15% की बचत है")).toBe("सालाना लेने पर पंद्रह प्रतिशत की बचत है");
    expect(spellOutHindiNumbers("इसमें 10 यूज़र हैं")).toBe("इसमें दस यूज़र हैं");
    expect(spellOutHindiNumbers("२०२६")).toBe("२०२६".replace("२०२६", "दो हज़ार छब्बीस"));
  });
  it("reads decimals digit by digit after the point", () => {
    expect(spellOutHindiNumbers("दर 2.5 है")).toBe("दर दो दशमलव पाँच है");
  });
  it("leaves English sentences alone, so the English voice reads their digits", () => {
    expect(spellOutHindiNumbers("The plan costs 4,999 rupees.")).toBe("The plan costs 4,999 rupees.");
    expect(forVoice("**4,999** rupees")).toBe("4,999 rupees");
  });
  it("cleans and spells out together", () => {
    expect(forVoice("**कीमत** 4,999 रुपये है 😊")).toBe("कीमत चार हज़ार नौ सौ निन्यानवे रुपये है");
  });
});
