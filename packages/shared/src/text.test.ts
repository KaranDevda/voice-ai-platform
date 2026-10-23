import { describe, expect, it } from "vitest";
import { chunkText, searchTerms } from "./text";

describe("chunkText", () => {
  it("returns short text whole and nothing for blanks", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
    expect(chunkText("  \n ")).toEqual([]);
  });

  it("keeps chunks within size, overlaps them, and loses no sentence", () => {
    const text = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i}.`).join(" ");
    const chunks = chunkText(text, 200, 40);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    for (let i = 0; i < 60; i++) expect(chunks.some((c) => c.includes(`number ${i}.`))).toBe(true);
    expect(chunks.slice(0, -1).every((c) => /[.]$/.test(c))).toBe(true);
  });

  it("always terminates, even with no breakpoints", () => {
    expect(chunkText("x".repeat(5000), 800, 100).length).toBeGreaterThan(5);
  });
});

describe("searchTerms", () => {
  it("drops stop words and short words, lowercases and dedupes", () => {
    expect(searchTerms("What is the Pricing for pricing plans?")).toEqual(["pricing", "plans"]);
    expect(searchTerms("हिंदी में कीमत")).toContain("कीमत");
  });
});
