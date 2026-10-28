import { describe, expect, it } from "vitest";
import { detectCallerLanguage, languageNote } from "./language";

describe("detectCallerLanguage", () => {
  it("recognises English", () => {
    for (const t of ["Hi, how are you?", "What plans do you have?", "How much is the Business plan?", "Can I speak to a person?"]) expect(detectCallerLanguage(t)).toBe("en");
  });
  it("recognises Hindi in Devanagari", () => {
    for (const t of ["नमस्ते, आप कैसे हैं?", "बिज़नेस प्लान की कीमत क्या है?", "ठीक है, धन्यवाद।"]) expect(detectCallerLanguage(t)).toBe("hi");
  });
  it("recognises Hinglish written in English letters", () => {
    for (const t of ["Hello, kaise ho aap?", "mujhe pricing ke baare mein batao", "kya aap call recording karte ho?", "theek hai, thanks", "business plan ka kitna hai"]) expect(detectCallerLanguage(t)).toBe("hinglish");
  });
  it("recognises Hinglish as a mix of scripts", () => {
    for (const t of ["हेलो, मुझे Business plan के बारे में जानना है", "क्या आप call record करते हैं?"]) expect(detectCallerLanguage(t)).toBe("hinglish");
    expect(detectCallerLanguage("उसमें कितने users मिलते हैं?")).toBe("hi"); // one English word in a Hindi sentence is still Hindi
  });
  it("does not mistake English for Hinglish", () => {
    for (const t of ["The key to the plan is the price", "I want to know the rate of the plan", "Please tell me about the pricing"]) expect(detectCallerLanguage(t)).toBe("en");
  });
  it("gives no answer for a short phrase with no evidence", () => {
    expect(detectCallerLanguage("okay")).toBeUndefined();
    expect(detectCallerLanguage("thanks")).toBeUndefined();
    expect(detectCallerLanguage("")).toBeUndefined();
  });
});

describe("languageNote", () => {
  it("tags Hindi and Hinglish, and leaves plain English untagged", () => {
    expect(languageNote("What plans do you have?")).toBe("");
    expect(languageNote("What plans do you have?", "How much is it?")).toBe("");
    expect(languageNote("आपके पास कौन से प्लान हैं?")).toBe("reply language: Hindi");
    expect(languageNote("mujhe pricing batao")).toBe("reply language: Hinglish");
  });
  it("tags English that follows another language, so the model switches back", () => {
    expect(languageNote("What plans do you have?", "आपके पास कौन से प्लान हैं?")).toBe("reply language: English");
  });
  it("carries on in the caller's earlier language when the latest words give no clue", () => {
    expect(languageNote("okay thanks", "mujhe pricing batao")).toBe("reply language: Hinglish");
    expect(languageNote("thanks", "नमस्ते")).toBe("reply language: Hindi");
    expect(languageNote("thanks")).toBe("");
  });
});
