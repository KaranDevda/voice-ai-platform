import { describe, expect, it } from "vitest";
import { hasEmotionTags, parseEmotionScript, stripEmotionTags } from "./emotion-tags";

describe("emotion tags", () => {
  it("styles the text after a tag until the next one", () => {
    const s = parseEmotionScript("Hello. [excited] Great news! [neutral] Details.");
    expect(s.map((x) => x.text)).toEqual(["Hello.", "Great news!", "Details."]);
    expect(s[0]!.speed).toBe(1);
    expect(s[1]!.speed).toBeGreaterThan(1);
    expect(s[2]!.speed).toBe(1);
  });
  it("understands Hindi names and never keeps the tag in the text", () => {
    const s = parseEmotionScript("[उदास] मुझे खेद है।");
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe("मुझे खेद है।");
    expect(s[0]!.pitch).toBeLessThan(0);
  });
  it("[pause] adds silence before the next part; an unknown tag is dropped", () => {
    const s = parseEmotionScript("One. [pause] Two. [whatever] Three.");
    expect(s[1]!.pauseBeforeMs).toBe(800);
    expect(s[2]!.text).toBe("Three.");
  });
  it("leaves markdown links alone", () => {
    expect(hasEmotionTags("see [docs](http://x.io)")).toBe(false);
    expect(stripEmotionTags("a [calm] b")).toBe("a b");
  });
});
