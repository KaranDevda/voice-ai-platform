import { describe, expect, it } from "vitest";
import { hinglishToDevanagari } from "./hinglish";

describe("hinglishToDevanagari", () => {
  it("writes the common English words of a Hinglish sentence the way Indians say them", () => {
    expect(hinglishToDevanagari("जी, Business plan की कीमत 4,999 रुपये है।")).toBe("जी, बिज़नेस प्लान की कीमत 4,999 रुपये है।");
    expect(hinglishToDevanagari("आप एक AI assistant से बात कर रहे हैं, और यह call record हो सकती है।")).toBe("आप एक ए आई असिस्टेंट से बात कर रहे हैं, और यह कॉल रिकॉर्ड हो सकती है।");
    expect(hinglishToDevanagari("बताइए, मैं आपकी कैसे help कर सकता हूँ?")).toBe("बताइए, मैं आपकी कैसे हेल्प कर सकता हूँ?");
  });
  it("converts Roman Hindi words inside an already mixed Devanagari sentence", () => {
    expect(hinglishToDevanagari("मेरा Business plan ka monthly price kya hai aur usme kitne users hain?"))
      .toBe("मेरा बिज़नेस प्लान का मंथली प्राइस क्या है और उसमें कितने यूज़र्स हैं?");
  });
  it("is not case sensitive and keeps punctuation", () => {
    expect(hinglishToDevanagari("नमस्ते! BUSINESS Plan, call-back।")).toBe("नमस्ते! बिज़नेस प्लान, कॉल-बैक।");
  });
  it("spells out abbreviations letter by letter", () => {
    expect(hinglishToDevanagari("आपका OTP आ गया")).toBe("आपका ओ टी पी आ गया");
    expect(hinglishToDevanagari("हमारा CRM अच्छा है")).toBe("हमारा सी आर एम अच्छा है");
  });
  it("leaves a word it does not know in English letters", () => {
    expect(hinglishToDevanagari("मेरा नाम Karan है")).toBe("मेरा नाम Karan है");
    expect(hinglishToDevanagari("यह Kubernetes क्या है")).toBe("यह Kubernetes क्या है");
  });
  it("never touches a sentence with no Hindi in it", () => {
    for (const t of ["Our Business plan starts at 4,999 rupees.", "Hello, thanks for calling Bizfy. OTP sent.", ""]) expect(hinglishToDevanagari(t)).toBe(t);
  });
  it("does not turn a long all-capitals word into spelled letters", () => {
    expect(hinglishToDevanagari("यह ABSOLUTELY है")).toBe("यह ABSOLUTELY है");
  });
});
