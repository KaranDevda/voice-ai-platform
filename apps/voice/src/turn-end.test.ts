import { describe, expect, it } from "vitest";
import { looksUnfinished } from "./turn-end";

describe("looksUnfinished", () => {
  it("waits when the caller stopped mid-sentence", () => {
    for (const t of ["I wanted to ask about", "my name is", "I want a demo because", "Can you tell me, ", "and", "मुझे प्लान के बारे में", "मेरा", "मुझे डेमो चाहिए क्योंकि", "main chahta hu ki", "Well..."]) expect(looksUnfinished(t), t).toBe(true);
  });
  it("answers at once when the sentence is finished", () => {
    for (const t of ["How much does the business plan cost?", "Do you record the calls?", "Yes.", "मेरा नाम रोहन मेहता है।", "क्या आप कॉल रिकॉर्ड करते हैं?", "ठीक है", "my number is 98765 43210", "I would like a demo this week", "main kal call karunga", "thank you", "okay sure", ""]) expect(looksUnfinished(t), t).toBe(false);
  });
});
