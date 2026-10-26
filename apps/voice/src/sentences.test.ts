import { describe, expect, it } from "vitest";
import { SentenceChunker } from "./sentences";

function chunk(text: string, size = 3, opts = {}) {
  const c = new SentenceChunker(opts);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...c.push(text.slice(i, i + size)));
  const rest = c.flush();
  if (rest) out.push(rest);
  return out;
}

describe("SentenceChunker", () => {
  it("splits streamed text into sentences however the tokens are cut", () => {
    const text = "Thanks for calling Bizfy. How can I help you today? I am here to help!";
    for (const size of [1, 2, 3, 7, 100]) expect(chunk(text, size)).toEqual(["Thanks for calling Bizfy.", "How can I help you today?", "I am here to help!"]);
  });
  it("does not split on decimals or short abbreviations", () => {
    expect(chunk("The plan costs 4999.50 rupees per month. Anything else?")).toEqual(["The plan costs 4999.50 rupees per month.", "Anything else?"]);
    expect(chunk("Dr. Rao will call you back tomorrow.")).toEqual(["Dr. Rao will call you back tomorrow."]);
  });
  it("lets a short opener like \"Sure.\" go out first, but not an abbreviation", () => {
    expect(chunk("Sure. The business plan costs four thousand nine hundred rupees.", 3)).toEqual(["Sure.", "The business plan costs four thousand nine hundred rupees."]);
    expect(chunk("Mr. Rao will call you back tomorrow.", 2)).toEqual(["Mr. Rao will call you back tomorrow."]);
  });
  it("splits Hindi on the danda", () => {
    expect(chunk("नमस्ते, बिज़्फी में आपका स्वागत है। मैं आपकी कैसे मदद कर सकता हूँ?")).toEqual(["नमस्ते, बिज़्फी में आपका स्वागत है।", "मैं आपकी कैसे मदद कर सकता हूँ?"]);
  });
  it("lets the first piece end at a comma once it is long enough, to start speaking sooner", () => {
    const out = chunk("Sure, I can look that up for you right now, and then we can book a time. Okay?", 4);
    expect(out[0]).toBe("Sure, I can look that up for you right now,");
    expect(out.join(" ")).toBe("Sure, I can look that up for you right now, and then we can book a time. Okay?");
  });
  it("returns the unfinished tail on flush", () => {
    const c = new SentenceChunker();
    expect(c.push("Hello there")).toEqual([]);
    expect(c.flush()).toBe("Hello there");
    expect(c.flush()).toBeNull();
  });
});
