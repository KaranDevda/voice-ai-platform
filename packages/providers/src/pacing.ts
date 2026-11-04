import { applyProsody } from "./prosody";
import type { Prosody } from "./prosody";
import type { SpeechResult, SpeechSynthesizer } from "./types";

/**
 * Natural pauses. A model that reads a whole paragraph in one go runs the sentences together at an even pace, which is what
 * "reads like a TV advert" sounds like. People stop between sentences: a little for a full stop, a bit more for a question, a
 * clear breath for a new paragraph, and never exactly the same length twice. So the text is cut into sentences, each is spoken
 * on its own, and real silence of a slightly different length is put between them.
 */
export interface Pacing { sentence: number; question: number; exclaim: number; ellipsis: number; paragraph: number; jitter: number }
/** Milliseconds. Tuned by ear on the Voices page; change here or pass your own. */
export const NATURAL_PACING: Pacing = { sentence: 520, question: 580, exclaim: 480, ellipsis: 720, paragraph: 950, jitter: 0.22 };

export interface Piece { text: string; pauseAfterMs: number }

/** Cuts text into sentences and says how long to pause after each. `random` is injectable so tests are exact. */
export function splitForPacing(text: string, pacing: Pacing = NATURAL_PACING, random: () => number = Math.random): Piece[] {
  const jitter = (ms: number) => Math.round(ms * (1 + (random() * 2 - 1) * pacing.jitter));
  const pieces: Piece[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const sentences = para.replace(/\s*\n\s*/g, " ").match(/(?:[^.!?।…]|\.(?=[\p{L}\p{N}]))+(?:\.\.\.|…|[.!?।]+)?["')\]]*\s*/gu) ?? [];
    sentences.forEach((raw, i) => {
      const t = raw.trim();
      if (!/[\p{L}\p{N}]/u.test(t)) return;
      const last = i === sentences.length - 1;
      const base = /(\.\.\.|…)$/.test(t) ? pacing.ellipsis : /\?["')\]]*$/.test(t) ? pacing.question : /!["')\]]*$/.test(t) ? pacing.exclaim : pacing.sentence;
      pieces.push({ text: t, pauseAfterMs: jitter(last ? pacing.paragraph : base) });
    });
  }
  if (pieces.length) pieces[pieces.length - 1]!.pauseAfterMs = 0;
  return pieces;
}

function wavToPcm(wav: Uint8Array): { rate: number; samples: Int16Array } | null {
  if (wav.length < 44 || wav[0] !== 0x52 || wav[8] !== 0x57) return null;
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let at = 12, rate = 24_000;
  while (at + 8 <= wav.length) {
    const id = String.fromCharCode(wav[at]!, wav[at + 1]!, wav[at + 2]!, wav[at + 3]!), size = v.getUint32(at + 4, true);
    if (id === "fmt ") { if (v.getUint16(at + 10, true) !== 1 || v.getUint16(at + 22, true) !== 16) return null; rate = v.getUint32(at + 12, true); }
    if (id === "data") { const b = wav.slice(at + 8, Math.min(wav.length, at + 8 + size)); return { rate, samples: new Int16Array(b.buffer, 0, b.length >> 1) }; }
    at += 8 + size + (size & 1);
  }
  return null;
}

function pcmToWav(samples: Int16Array, rate: number): Uint8Array {
  const data = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = new Uint8Array(44), v = new DataView(h.buffer);
  h.set([0x52, 0x49, 0x46, 0x46]); v.setUint32(4, 36 + data.length, true); h.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); h.set([0x64, 0x61, 0x74, 0x61], 36); v.setUint32(40, data.length, true);
  const out = new Uint8Array(44 + data.length); out.set(h); out.set(data, 44); return out;
}

/** Fades the first and last few milliseconds so joined sentences do not click. Nothing is cut, so no part of a word is lost. */
function edge(x: Int16Array, rate: number): Int16Array {
  const fin = Math.min(Math.floor(rate * 0.006), x.length >> 1), fout = Math.min(Math.floor(rate * 0.025), x.length >> 1), y = x.slice();
  for (let i = 0; i < fin; i++) y[i] = Math.round(y[i]! * (i / fin));
  for (let i = 0; i < fout; i++) y[y.length - 1 - i] = Math.round(y[y.length - 1 - i]! * (0.5 - 0.5 * Math.cos((Math.PI * i) / fout)));
  return y;
}

/** Runs `fn` over the items, a few at a time, and returns the results in the original order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}
/** Sentences made at the same time. Hindi in a cloned voice is two steps (built-in voice, then conversion), so while one sentence converts the next is being spoken. */
const PARALLEL = 3;

/** Cleans the end of a finished 16-bit WAV (noisy tail trimmed, smooth fade-out). Anything else comes back unchanged. */
export function tidyWavEnds(wav: Uint8Array): Uint8Array {
  const pcm = wavToPcm(wav);
  return pcm ? pcmToWav(edge(pcm.samples, pcm.rate), pcm.rate) : wav;
}

/**
 * Speaks text sentence by sentence with natural pauses between them. A single sentence, or audio that is not 16-bit WAV, is
 * returned as the engine made it.
 */
export async function speakPaced(
  engine: SpeechSynthesizer,
  input: { text: string; voiceId: string; hindiVoice?: string; signal?: AbortSignal },
  pacing: Pacing = NATURAL_PACING,
  random: () => number = Math.random,
): Promise<SpeechResult> {
  const pieces = splitForPacing(input.text, pacing, random);
  if (pieces.length <= 1) return engine.speak({ ...input, text: pieces[0]?.text ?? input.text, format: "mp3" });
  const made = await mapLimit(pieces, PARALLEL, async (p) => {
    if (input.signal?.aborted) throw new Error("aborted");
    return engine.speak({ ...input, text: p.text, format: "mp3" });
  });
  const parts: Int16Array[] = [];
  let rate = 24_000, hindiVoice: SpeechResult["hindiVoice"];
  const first = made[0]!;
  for (const [i, r] of made.entries()) {
    const pcm = wavToPcm(r.audio);
    if (!pcm) return first.mime === "audio/wav" ? first : engine.speak({ ...input, format: "mp3" }); // not something we can join: give back one plain piece
    rate = pcm.rate; hindiVoice = r.hindiVoice ?? hindiVoice;
    parts.push(edge(pcm.samples, rate));
    if (pieces[i]!.pauseAfterMs > 0) parts.push(new Int16Array(Math.round((rate * pieces[i]!.pauseAfterMs) / 1000)));
  }
  const all = new Int16Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of parts) { all.set(a, o); o += a.length; }
  return { audio: pcmToWav(all, rate), mime: "audio/wav", hindiVoice, engine: first?.engine, note: first?.note };
}

export interface StyledSegment { text: string; speed: number; pitch: number; pauseScale: number; pauseBeforeMs: number }

/**
 * Like speakPaced, but each segment (from emotion tags) gets its own speed, pitch and pause length on top of the voice's own settings.
 * If the engine does not return WAV (e.g. MP3 from ElevenLabs) the pieces cannot be shaped, so the plain text is spoken once.
 */
export async function speakStyled(
  engine: SpeechSynthesizer,
  input: { voiceId: string; hindiVoice?: string; signal?: AbortSignal },
  segments: StyledSegment[],
  base: Partial<Prosody> = {},
  pacing: Pacing = NATURAL_PACING,
  random: () => number = Math.random,
): Promise<SpeechResult> {
  const plain = () => engine.speak({ ...input, text: segments.map((s) => s.text).join("\n\n"), format: "mp3" });
  const jobs = segments.flatMap((seg) => splitForPacing(seg.text, pacing, random).map((p) => ({ seg, p })));
  const made = await mapLimit(jobs, PARALLEL, async ({ p }) => {
    if (input.signal?.aborted) throw new Error("aborted");
    return engine.speak({ ...input, text: p.text, format: "mp3" });
  });
  const parts: Int16Array[] = [];
  let rate = 24_000, hindiVoice: SpeechResult["hindiVoice"];
  const first: SpeechResult | undefined = made[0];
  let lastSeg: StyledSegment | undefined;
  for (const [i, r] of made.entries()) {
    const { seg, p } = jobs[i]!;
    const pcm = wavToPcm(r.audio);
    if (!pcm) return plain();
    rate = pcm.rate; hindiVoice = r.hindiVoice ?? hindiVoice;
    if (seg !== lastSeg && seg.pauseBeforeMs > 0 && parts.length) parts.push(new Int16Array(Math.round((rate * seg.pauseBeforeMs) / 1000)));
    lastSeg = seg;
    const style = { speed: (base.speed ?? 1) * seg.speed, pitch: (base.pitch ?? 0) + seg.pitch };
    parts.push(applyProsody(edge(pcm.samples, rate), rate, style));
    const pause = p.pauseAfterMs * seg.pauseScale;
    if (pause > 0) parts.push(new Int16Array(Math.round((rate * pause) / 1000)));
  }
  if (!first) return plain();
  const all = new Int16Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of parts) { all.set(a, o); o += a.length; }
  return { audio: pcmToWav(all, rate), mime: "audio/wav", hindiVoice, engine: first.engine, note: first.note };
}
