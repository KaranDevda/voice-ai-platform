import { describe, expect, it } from "vitest";
import { hinglishToDevanagari } from "./hinglish";
import { applyProsody, applyProsodyToWav, clampProsody } from "./prosody";

const SCRIPT = "Hey! Kafi time se baat nahi hui, sab badhiya? Bas aise hi tumhari yaad aayi toh socha ek baar message karke pooch loon. Aaj kal toh life thodi zyada hi busy chal rahi hai, par we seriously need to catch up soon. Is weekend scene banayein? Batana kab free ho, milte hain!";

describe("Hinglish typed in English letters", () => {
  it("turns the Hindi words into Devanagari and keeps English words speakable", () => {
    const out = hinglishToDevanagari(SCRIPT);
    console.log(out);
    expect(out).toContain("काफ़ी टाइम से बात नहीं हुई, सब बढ़िया?");
    expect(out).toContain("इस वीकेंड सीन बनाएँ?");
    expect(out).toContain("बताना कब फ़्री हो, मिलते हैं!");
    expect(out).toContain("पर वी सीरियसली नीड");
  });
  it("leaves plain English alone", () => {
    for (const t of ["Hi, how are you? Is this a good time to talk?", "We will do it in the morning, so please call me."]) expect(hinglishToDevanagari(t)).toBe(t);
  });
});

describe("speed and pitch", () => {
  const rate = 24_000;
  const tone = Int16Array.from({ length: rate }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 200 * i) / rate)));
  const crossings = (s: Int16Array) => { let n = 0; for (let i = 1; i < s.length; i++) if (s[i - 1]! < 0 && s[i]! >= 0) n++; return n; };
  it("changes length with speed and keeps the pitch", () => {
    const slow = applyProsody(tone, rate, { speed: 0.8 }), fast = applyProsody(tone, rate, { speed: 1.25 });
    expect(slow.length / rate).toBeCloseTo(1.25, 1);
    expect(fast.length / rate).toBeCloseTo(0.8, 1);
    expect(crossings(slow) / (slow.length / rate)).toBeGreaterThan(190);
    expect(crossings(slow) / (slow.length / rate)).toBeLessThan(210);
  });
  it("shifts pitch and keeps the length", () => {
    const up = applyProsody(tone, rate, { pitch: 3 });
    expect(up.length / rate).toBeCloseTo(1, 1);
    expect(crossings(up) / (up.length / rate)).toBeGreaterThan(200 * 2 ** (3 / 12) - 8);
    expect(crossings(up) / (up.length / rate)).toBeLessThan(200 * 2 ** (3 / 12) + 8);
  });
  it("does nothing at the neutral setting, and clamps wild values", () => {
    expect(applyProsody(tone, rate, { speed: 1, pitch: 0 })).toBe(tone);
    expect(clampProsody({ speed: 5, pitch: -40 })).toEqual({ speed: 1.5, pitch: -3 });
  });
  it("works on a WAV file", () => {
    const wav = new Uint8Array(44 + tone.byteLength);
    new TextEncoder().encodeInto("RIFF", wav); new DataView(wav.buffer).setUint32(4, 36 + tone.byteLength, true); wav.set(new TextEncoder().encode("WAVEfmt "), 8);
    const v = new DataView(wav.buffer); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wav.set(new TextEncoder().encode("data"), 36); v.setUint32(40, tone.byteLength, true); wav.set(new Uint8Array(tone.buffer), 44);
    const out = applyProsodyToWav(wav, { speed: 1.25 });
    expect((out.length - 44) / 2 / rate).toBeCloseTo(0.8, 1);
  });
});
