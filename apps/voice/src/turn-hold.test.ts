import { describe, expect, it, vi } from "vitest";
import { Conversation, type ServerEvent } from "./pipeline";
import { looksUnfinished } from "./turn-end";
// The decision itself is covered in turn-end.test.ts; this checks that the wait merges the two pieces into one question.
describe("holding an unfinished sentence", () => {
  it("two pieces of one sentence are one question", () => {
    vi.useFakeTimers();
    const sent: ServerEvent[] = [];
    const c = new Conversation({ holdUnfinishedMs: 600, send: (e: ServerEvent) => sent.push(e), sendAudio: () => {}, now: () => Date.now() } as never) as unknown as { onFinalText(t: string): void; begin(t: string | null): void };
    const begun: string[] = [];
    c.begin = (t) => { if (t) begun.push(t); };
    c.onFinalText("I wanted to ask about");
    expect(begun).toEqual([]);
    vi.advanceTimersByTime(300);
    c.onFinalText("the business plan.");
    expect(begun).toEqual(["I wanted to ask about the business plan."]);
    c.onFinalText("Do you record calls?");
    expect(begun).toHaveLength(2);
    c.onFinalText("my name is");
    vi.advanceTimersByTime(700);
    expect(begun.at(-1)).toBe("my name is");
    expect(looksUnfinished("my name is")).toBe(true);
    vi.useRealTimers();
  });
});
