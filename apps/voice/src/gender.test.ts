import { describe, expect, it } from "vitest";
import { matchGender, speakerNote } from "./gender";

describe("matchGender", () => {
  it("turns a man's first-person Hindi into a woman's", () => {
    expect(matchGender("बताइए, मैं आपकी क्या मदद कर सकता हूँ?", "female")).toBe("बताइए, मैं आपकी क्या मदद कर सकती हूँ?");
    expect(matchGender("मैं आपकी बात हमारे एक सहयोगी से करवाता हूँ।", "female")).toBe("मैं आपकी बात हमारे एक सहयोगी से करवाती हूँ।");
    expect(matchGender("मैं देख रहा हूं", "female")).toBe("मैं देख रही हूं");
    expect(matchGender("मैं बता सकता हूं और समझ सकता हूँ", "female")).toBe("मैं बता सकती हूं और समझ सकती हूँ");
  });
  it("turns a woman's into a man's", () => {
    expect(matchGender("मैं आपकी मदद कर सकती हूँ", "male")).toBe("मैं आपकी मदद कर सकता हूँ");
    expect(matchGender("मैं देख रही हूँ", "male")).toBe("मैं देख रहा हूँ");
  });
  it("leaves already-correct text, English, and other words alone", () => {
    expect(matchGender("मैं आपकी मदद कर सकती हूँ", "female")).toBe("मैं आपकी मदद कर सकती हूँ");
    expect(matchGender("I can help you, sir.", "female")).toBe("I can help you, sir.");
    expect(matchGender("आपका प्लान चार हज़ार रुपये का है", "female")).toBe("आपका प्लान चार हज़ार रुपये का है"); // "का है" is not a first-person verb
    expect(matchGender("हमारा बेटा खेलता है", "female")).toBe("हमारा बेटा खेलता है"); // third person: not touched
    expect(matchGender("मैं ठीक हूँ, धन्यवाद।", "female")).toBe("मैं ठीक हूँ, धन्यवाद।");
  });
  it("keeps a mixed Hindi and English sentence readable", () => {
    expect(matchGender("मैं आपकी कैसे help कर सकता हूँ?", "female")).toBe("मैं आपकी कैसे help कर सकती हूँ?");
  });
  it("tells the AI which gender it is", () => {
    expect(speakerNote("female")).toContain("woman");
    expect(speakerNote("male")).toContain("man");
  });
});
