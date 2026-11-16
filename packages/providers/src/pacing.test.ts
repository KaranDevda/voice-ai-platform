import { describe, expect, it } from "vitest";
import { speakPaced, splitForPacing, NATURAL_PACING } from "./pacing";

const wav = (n: number, rate = 24_000) => { const b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer); b.set([0x52,0x49,0x46,0x46],0); v.setUint32(4,36+n*2,true); b.set([0x57,0x41,0x56,0x45,0x66,0x6d,0x74,0x20],8); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,rate,true); v.setUint32(28,rate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); b.set([0x64,0x61,0x74,0x61],36); v.setUint32(40,n*2,true); for (let i=0;i<n;i++) v.setInt16(44+2*i, 8000, true); return b; };
const mid = () => 0.5; // jitter 0

describe("splitForPacing", () => {
  it("cuts sentences and pauses longer after a question and a paragraph", () => {
    const p = splitForPacing("Hello there. How are you? Fine!\n\nNew paragraph here.", NATURAL_PACING, mid);
    expect(p.map((x) => x.text)).toEqual(["Hello there.", "How are you?", "Fine!", "New paragraph here."]);
    expect(p.map((x) => x.pauseAfterMs)).toEqual([520, 580, 950, 0]);
  });
  it("handles Hindi full stops and ellipses", () => {
    const p = splitForPacing("नमस्ते। आप कैसे हैं... ठीक है।", NATURAL_PACING, mid);
    expect(p.map((x) => x.text)).toEqual(["नमस्ते।", "आप कैसे हैं...", "ठीक है।"]);
    expect(p[1]!.pauseAfterMs).toBe(720);
  });
  it("never pauses the same length twice", () => {
    let k = 0; const r = () => [0.1, 0.9, 0.4][k++ % 3]!;
    const p = splitForPacing("One. Two. Three. Four.", NATURAL_PACING, r);
    expect(new Set(p.slice(0, 3).map((x) => x.pauseAfterMs)).size).toBe(3);
  });
});

describe("speakPaced", () => {
  it("joins sentences with silence in between", async () => {
    const engine = { speak: async () => ({ audio: wav(2400), mime: "audio/wav" }) };
    const r = await speakPaced(engine, { text: "One. Two.", voiceId: "v" }, NATURAL_PACING, mid);
    expect((r.audio.length - 44) / 2).toBe(2400 + 12_480 + 2400); // two 0.1 s sentences and a 0.52 s pause
  });
  it("leaves one sentence as the engine made it", async () => {
    const one = wav(100);
    const r = await speakPaced({ speak: async () => ({ audio: one, mime: "audio/wav" }) }, { text: "Just one sentence", voiceId: "v" });
    expect(r.audio).toBe(one);
  });

  it("re-speaks the full text if sentence audio cannot be joined", async () => {
    const full = wav(4800);
    const calls: string[] = [];
    const engine = { speak: async ({ text }: { text: string }) => {
      calls.push(text);
      return text === "Two."
        ? { audio: new Uint8Array(8), mime: "audio/wav" }
        : { audio: text === "One." ? wav(2400) : full, mime: "audio/wav" };
    } };
    const r = await speakPaced(engine, { text: "One. Two.", voiceId: "v" }, NATURAL_PACING, mid);
    expect(calls).toContain("One. Two.");
    expect(r.audio).toEqual(full);
  });
});
