import { describe, expect, it } from "vitest";
import { Vad } from "./vad";

const RATE = 16_000;
const tone = (ms: number, amp = 0.2) => Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => Math.round(Math.sin(i / 6) * amp * 32767));
const quiet = (ms: number, amp = 0.002) => Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => Math.round(Math.sin(i * 1.7) * amp * 32767));
const cat = (...a: Int16Array[]) => { const o = new Int16Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

/** Feeds audio in uneven slices, like network packets. */
function feed(vad: Vad, audio: Int16Array, slice = 333) {
  const ev = [];
  for (let i = 0; i < audio.length; i += slice) ev.push(...vad.push(audio.subarray(i, i + slice)));
  return ev;
}

describe("Vad", () => {
  it("finds one utterance in silence-speech-silence and reports when it starts", () => {
    const ev = feed(new Vad(), cat(quiet(500), tone(1200), quiet(800)));
    expect(ev.map((e) => e.kind)).toEqual(["start", "end"]);
    const end = ev[1] as { kind: "end"; pcm: Int16Array; speechMs: number };
    expect(end.speechMs).toBeGreaterThan(1000);
    expect(end.pcm.length / RATE).toBeGreaterThan(1.2);   // includes the speech plus a little lead-in and tail
    expect(end.pcm.length / RATE).toBeLessThan(1.9);      // but not the long trailing silence
  });

  it("keeps a lead-in so the first word is not clipped", () => {
    const ev = feed(new Vad({ preRollMs: 300 }), cat(quiet(1000), tone(600), quiet(700)));
    const end = ev.find((e) => e.kind === "end") as { pcm: Int16Array };
    expect(end.pcm.length / RATE).toBeGreaterThan(0.6 + 0.2);
  });

  it("does not split an utterance at a short pause, but does at a long one", () => {
    const short = feed(new Vad({ endSilenceMs: 400 }), cat(quiet(300), tone(700), quiet(250), tone(700), quiet(800)));
    expect(short.filter((e) => e.kind === "end")).toHaveLength(1);
    const long = feed(new Vad({ endSilenceMs: 400 }), cat(quiet(300), tone(700), quiet(600), tone(700), quiet(800)));
    expect(long.filter((e) => e.kind === "end")).toHaveLength(2);
  });

  it("ignores a click and background hiss", () => {
    const ev = feed(new Vad(), cat(quiet(800, 0.004), tone(40), quiet(800), tone(60, 0.3), quiet(800)));
    expect(ev).toEqual([]);
  });

  it("adapts to steady noise and still hears speech above it", () => {
    const noisy = (ms: number) => quiet(ms, 0.01);
    const ev = feed(new Vad(), cat(noisy(1500), tone(900, 0.3), noisy(900)));
    expect(ev.map((e) => e.kind)).toEqual(["start", "end"]);
  });

  it("cuts a very long utterance instead of waiting forever", () => {
    const ev = feed(new Vad({ maxUtteranceMs: 2000 }), cat(tone(5000)));
    expect(ev.filter((e) => e.kind === "end").length).toBeGreaterThanOrEqual(2);
  });

  it("flush returns speech that was still going when the stream ended", () => {
    const vad = new Vad();
    const ev = [...feed(vad, cat(quiet(300), tone(900))), ...vad.flush()];
    expect(ev.map((e) => e.kind)).toEqual(["start", "end"]);
  });
});
