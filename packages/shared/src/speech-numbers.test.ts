import { describe, expect, it } from "vitest";
import { englishIndianWords, speakableNumbers } from "./speech-numbers";
import { spellOutHindiNumbers } from "./hindi";

describe("speakableNumbers", () => {
  it("says Indian amounts with lakh and crore", () => {
    expect(englishIndianWords(4999)).toBe("four thousand nine hundred ninety-nine");
    expect(englishIndianWords(1250000)).toBe("twelve lakh fifty thousand");
    expect(englishIndianWords(30000000)).toBe("three crore");
    expect(speakableNumbers("It is ₹4,999 per month.")).toBe("It is four thousand nine hundred ninety-nine rupees per month.");
    expect(speakableNumbers("Rs. 12,50,000 total")).toBe("twelve lakh fifty thousand rupees total");
    expect(speakableNumbers("INR 1.5 lakh")).toBe("one point five lakh rupees");
    expect(speakableNumbers("₹499.50")).toBe("four hundred ninety-nine rupees and fifty paise");
  });
  it("reads phone numbers and OTPs digit by digit", () => {
    expect(speakableNumbers("call 98765 43210")).toBe("call nine eight seven six five, four three two one zero");
    expect(speakableNumbers("+91 9876543210")).toBe("nine eight seven six five, four three two one zero");
    expect(speakableNumbers("Your OTP is 482913")).toBe("Your OTP is four eight two nine one three");
    expect(spellOutHindiNumbers(speakableNumbers("मेरा नंबर 98765 43210 है"))).toBe("मेरा नंबर नौ आठ सात छह पाँच, चार तीन दो एक शून्य है");
  });
  it("leaves ordinary numbers, years and times alone", () => {
    expect(speakableNumbers("We open at 4:30 pm on 03/11/2026, 25 seats.")).toBe("We open at 4:30 pm on 03/11/2026, 25 seats.");
  });
  it("says e-mail addresses", () => {
    expect(speakableNumbers("mail rohan.mehta@bizfy.in")).toBe("mail rohan mehta at bizfy dot in");
  });
  it("keeps the Hindi rupee handling", () => {
    expect(spellOutHindiNumbers(speakableNumbers("प्लान ₹4,999 है"))).toBe("प्लान चार हज़ार नौ सौ निन्यानवे रुपये है");
  });
});
