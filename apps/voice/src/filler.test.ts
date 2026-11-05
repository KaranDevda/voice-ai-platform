import { describe, expect, it } from "vitest";
import { dropFiller } from "./filler";

describe("dropFiller", () => {
  it("drops a sentence that is only stalling", () => {
    for (const s of ["Sure, let me check that.", "Let me check that for you.", "Sure! Let me look that up.", "One moment, let me see.", "Certainly, I'll check on that.", "Just a moment.", "Hold on while I check.", "ज़रा देखता हूँ।", "बस एक पल।"]) expect(dropFiller(s), s).toBe("");
  });
  it("keeps real answers, including ones that mention checking", () => {
    for (const s of ["I'm doing well, thank you! How can I help you today?", "You can check your balance on the Billing page.", "We offer three plans.", "Let me know if you would like a demo.", "Yes, we record calls for quality.", "आपका स्वागत है।"]) expect(dropFiller(s), s).toBe(s);
  });
  it("cuts a stalling opener from the front of an answer", () => {
    expect(dropFiller("Sure, we do record calls.")).toBe("We do record calls.");
    expect(dropFiller("Certainly, the pro plan is 4,999 rupees.")).toBe("The pro plan is 4,999 rupees.");
  });
});
