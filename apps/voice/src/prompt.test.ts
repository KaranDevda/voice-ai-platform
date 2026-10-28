import { describe, expect, it } from "vitest";
import { knowledgeBlock, VOICE_RULES } from "./prompt";
import { languageNote } from "./language";

// The per-turn tags are short on purpose (the model reads them fresh every turn); their meaning lives in the cached system prompt.
describe("per-turn tags", () => {
  it("are explained in the system prompt", () => {
    for (const tag of ["reply language: English", "reply language: Hindi", "reply language: Hinglish", "company knowledge:", "company knowledge: none", "never read it out", "do not guess"]) expect(VOICE_RULES).toContain(tag);
  });

  it("stay short", () => {
    expect(knowledgeBlock([]).length).toBeLessThan(40);
    expect(languageNote("नमस्ते").length).toBeLessThan(40);
    expect(languageNote("What plans do you have?")).toBe("");
  });

  it("list the knowledge passages when there are some", () => {
    expect(knowledgeBlock(["Business plan: 4,999 rupees"])).toMatch(/^company knowledge:\n\[1\] Business plan/);
  });
});
