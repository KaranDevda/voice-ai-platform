import { describe, expect, it } from "vitest";
import { activeLine, srtTime, toPlainText, toSrt } from "./transcript";

const lines = [
  { speaker: 0, startMs: 800, endMs: 5200, text: "Hello there." },
  { speaker: 1, startMs: 5800, endMs: 5900, text: "Hi." },
  { speaker: 1, startMs: 7000, endMs: 9000, text: "How are you?" },
];

describe("transcript formats", () => {
  it("formats SubRip timestamps across hours, minutes and milliseconds", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(62_345)).toBe("00:01:02,345");
    expect(srtTime(3_723_004)).toBe("01:02:03,004");
    expect(srtTime(-5)).toBe("00:00:00,000");
  });

  it("builds valid SRT with numbered cues, speaker names and a minimum cue length", () => {
    const srt = toSrt(lines);
    expect(srt.startsWith("1\n00:00:00,800 --> 00:00:05,200\nSpeaker 1: Hello there.\n")).toBe(true);
    expect(srt).toContain("2\n00:00:05,800 --> 00:00:06,300\nSpeaker 2: Hi.");
    expect(toSrt(lines, false)).not.toContain("Speaker");
  });

  it("labels speakers only when they change, and omits labels for a single speaker", () => {
    expect(toPlainText(lines)).toBe("Speaker 1:\nHello there.\n\nSpeaker 2:\nHi.\nHow are you?");
    expect(toPlainText([lines[0]!, { ...lines[0]!, startMs: 6000, text: "More." }])).toBe("Hello there.\nMore.");
  });

  it("finds the line being spoken", () => {
    expect(activeLine(lines, 0)).toBe(-1);
    expect(activeLine(lines, 800)).toBe(0);
    expect(activeLine(lines, 6500)).toBe(1);
    expect(activeLine(lines, 99_000)).toBe(2);
    expect(activeLine([], 100)).toBe(-1);
  });
});
