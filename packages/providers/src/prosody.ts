/**
 * Speed and pitch for a finished piece of speech, in plain TypeScript (no ffmpeg or other tool needed).
 * Pitch is a resample (which changes pitch and length together) followed by a WSOLA time-stretch that puts the length right;
 * speed is the same time-stretch with no resample, so words are not squeaky or slurred. Small settings stay clean: the
 * limits below are what keeps consonants clear (a big pitch shift "eats words", measured on 26 Oct).
 */
export interface Prosody { speed: number; pitch: number }

export const SPEED_RANGE = { min: 0.8, max: 1.25 } as const;
/** Semitones. Plus or minus 3 is a clearly different voice that is still easy to understand. */
export const PITCH_RANGE = { min: -3, max: 3 } as const;

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
export const clampProsody = (p?: Partial<Prosody> | null): Prosody => ({
  speed: Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, num(p?.speed, 1))),
  pitch: Math.min(PITCH_RANGE.max, Math.max(PITCH_RANGE.min, num(p?.pitch, 0))),
});
export const isNeutralProsody = (p?: Partial<Prosody> | null) => { const c = clampProsody(p); return Math.abs(c.speed - 1) < 0.005 && Math.abs(c.pitch) < 0.05; };

function resample(x: Float32Array, step: number): Float32Array {
  const out = new Float32Array(Math.max(1, Math.floor((x.length - 1) / step)));
  for (let i = 0; i < out.length; i++) {
    const pos = i * step, j = Math.floor(pos), frac = pos - j;
    out[i] = x[j]! * (1 - frac) + (x[j + 1] ?? x[j]!) * frac;
  }
  return out;
}

/** Waveform-similarity overlap-add: output length is `ratio` times the input length, pitch unchanged. */
function wsola(x: Float32Array, ratio: number, rate: number): Float32Array {
  const N = Math.round(rate * 0.032) & ~1, Hs = N / 2, Ha = Hs / ratio, tol = Math.round(rate * 0.012);
  const outLen = Math.max(1, Math.round(x.length * ratio));
  const y = new Float32Array(outLen + N), norm = new Float32Array(outLen + N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / N);
  const at = (i: number) => (i >= 0 && i < x.length ? x[i]! : 0);
  let prev = 0;
  for (let k = 0; k * Hs < outLen; k++) {
    let pos = Math.round(k * Ha);
    if (k > 0) {
      const target = prev + Hs; // where the previous frame would naturally have continued
      let best = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const cand = pos + d;
        if (cand < 0 || cand >= x.length) continue;
        let dot = 0, e = 1e-9;
        for (let i = 0; i < Hs; i += 3) { const a = at(cand + i); dot += a * at(target + i); e += a * a; }
        const score = dot / Math.sqrt(e);
        if (score > best) { best = score; pos = cand; }
      }
    }
    const o = k * Hs;
    for (let i = 0; i < N; i++) { y[o + i]! += win[i]! * at(pos + i); norm[o + i]! += win[i]!; }
    prev = pos;
  }
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = norm[i]! > 1e-3 ? y[i]! / norm[i]! : 0;
  return out;
}

/** Applies speed (1 = normal) and pitch (semitones, 0 = normal) to 16-bit mono samples. Untouched when both are neutral. */
export function applyProsody(samples: Int16Array, rate: number, prosody?: Partial<Prosody> | null): Int16Array {
  if (isNeutralProsody(prosody) || samples.length < rate * 0.1) return samples;
  const { speed, pitch } = clampProsody(prosody);
  const factor = 2 ** (pitch / 12);
  let x: Float32Array = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) x[i] = samples[i]! / 32768;
  if (Math.abs(factor - 1) > 0.002) x = resample(x, factor); // pitch up by `factor`, and the speech gets shorter by the same amount
  const ratio = factor / speed; // length still wanted, relative to what is there now
  if (Math.abs(ratio - 1) > 0.005) x = wsola(x, ratio, rate);
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(x[i]! * 32768)));
  // A very short fade-out removes the click the stretch can leave at the end.
  const fade = Math.min(Math.floor(rate * 0.012), out.length >> 2);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] = Math.round(out[out.length - 1 - i]! * (0.5 - 0.5 * Math.cos((Math.PI * i) / fade)));
  return out;
}

/** Applies speed and pitch to a 16-bit mono PCM WAV file (the kind this product makes) and returns a WAV. Other formats come back unchanged. */
export function applyProsodyToWav(wav: Uint8Array, prosody?: Partial<Prosody> | null): Uint8Array {
  if (isNeutralProsody(prosody) || wav.length < 44 || wav[0] !== 0x52 || wav[8] !== 0x57) return wav;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let at = 12, rate = 24_000;
  while (at + 8 <= wav.length) {
    const id = String.fromCharCode(wav[at]!, wav[at + 1]!, wav[at + 2]!, wav[at + 3]!), size = view.getUint32(at + 4, true);
    if (id === "fmt ") { if (view.getUint16(at + 8 + 2, true) !== 1 || view.getUint16(at + 8 + 14, true) !== 16) return wav; rate = view.getUint32(at + 8 + 4, true); }
    if (id === "data") {
      const bytes = wav.slice(at + 8, Math.min(wav.length, at + 8 + size));
      const out = applyProsody(new Int16Array(bytes.buffer, 0, bytes.length >> 1), rate, prosody);
      const h = new Uint8Array(44), hv = new DataView(h.buffer);
      h.set([0x52, 0x49, 0x46, 0x46]); hv.setUint32(4, 36 + out.byteLength, true); h.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
      hv.setUint32(16, 16, true); hv.setUint16(20, 1, true); hv.setUint16(22, 1, true); hv.setUint32(24, rate, true); hv.setUint32(28, rate * 2, true);
      hv.setUint16(32, 2, true); hv.setUint16(34, 16, true); h.set([0x64, 0x61, 0x74, 0x61], 36); hv.setUint32(40, out.byteLength, true);
      const res = new Uint8Array(44 + out.byteLength);
      res.set(h); res.set(new Uint8Array(out.buffer, 0, out.byteLength), 44);
      return res;
    }
    at += 8 + size + (size & 1);
  }
  return wav;
}
