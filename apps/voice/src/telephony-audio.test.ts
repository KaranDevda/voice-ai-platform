import { describe, expect, it } from "vitest";
import { pcmToMulaw8k } from "@voiceai/providers";
import { MulawTo16k } from "./telephony-audio";

const tone = (hz: number, ms: number, rate = 8000) => Int16Array.from({ length: (rate * ms) / 1000 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / rate)));
const toSamples = (b: Uint8Array) => new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1);

describe("phone audio to speech-recognition audio", () => {
  it("doubles the number of samples", () => {
    const mulaw = pcmToMulaw8k(tone(440, 100), 8000);
    expect(mulaw.length).toBe(800);
    expect(toSamples(new MulawTo16k().convert(mulaw)).length).toBe(1600);
  });
  it("keeps the sound: a 440 Hz tone is still about as loud after the conversion", () => {
    const out = toSamples(new MulawTo16k().convert(pcmToMulaw8k(tone(440, 200), 8000)));
    const rms = Math.sqrt(out.reduce((n, x) => n + x * x, 0) / out.length);
    expect(rms).toBeGreaterThan(4500); // a sine of amplitude 8000 has rms about 5657
    expect(rms).toBeLessThan(6500);
  });
  it("gives the same result whether the audio comes in one piece or in 20 ms chunks", () => {
    const mulaw = pcmToMulaw8k(tone(300, 200), 8000);
    const whole = new MulawTo16k().convert(mulaw);
    const c = new MulawTo16k(), parts: number[] = [];
    for (let i = 0; i < mulaw.length; i += 160) parts.push(...c.convert(mulaw.subarray(i, i + 160)));
    expect(Uint8Array.from(parts)).toEqual(whole);
  });
  it("turns silence into silence", () => {
    expect(toSamples(new MulawTo16k().convert(pcmToMulaw8k(new Int16Array(160), 8000))).every((x) => Math.abs(x) < 20)).toBe(true);
  });
});
