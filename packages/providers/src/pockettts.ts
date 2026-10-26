import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ProviderError, type AudioFormat, type MulawFrame, type SpeechResult, type SpeechSynthesizer, type TtsAdapter } from "./types";
import type { CloneSample } from "./elevenlabs";
import { hinglishToDevanagari } from "./hinglish";

const run = promisify(execFile);

export type PocketLanguage = "en" | "hi";

export interface PocketTtsConfig {
  /** Base URL of `pocket-tts serve` for English, e.g. http://127.0.0.1:8765 */
  baseUrl: string;
  /**
   * Extra language models, each its own `pocket-tts serve`. `exportArgs` selects that model when exporting a voice
   * (for Hindi: ["--config", "hf://saryps-labs/pocket-tts-hindi/config.yaml@<commit>"]). A voice file only works with
   * the model that made it, so every language needs its own file.
   */
  languages?: Partial<Record<Exclude<PocketLanguage, "en">, { baseUrl: string; exportArgs: string[] }>>;
  /**
   * Kokoro server for Hindi. It has fixed voices and cannot clone, but its Hindi is far more reliable than the Pocket Hindi
   * model's. When set, any sentence with Hindi in it (Hindi or Hinglish) is spoken entirely by Kokoro, so one sentence never
   * switches voice halfway; sentences in plain English are still spoken by the person's cloned voice.
   */
  kokoro?: { baseUrl: string };
  /**
   * Voice-conversion server. Turns Kokoro's Hindi into the person's own voice using a fingerprint made when they were cloned.
   * Voices without a fingerprint, or any failure of this server, fall back to the built-in Hindi voice, never to an error.
   */
  convert?: { baseUrl: string };
  /** Told when Hindi could not be converted to the person's voice, so the caller can say so. */
  onNotConverted?: (providerVoiceId: string, why: "no_fingerprint" | "unavailable") => void;
  /** Path to the pocket-tts binary; only needed to create clones (export-voice). */
  binPath?: string;
  /** Where exported voice files (.safetensors) are kept. A voice file is biometric data: restrict access to it. */
  voicesDir?: string;
  /** Web address the TTS server uses to fetch a stored voice file. Must be reachable only from the TTS server. */
  voiceUrl?: (providerVoiceId: string, language: PocketLanguage) => string;
  /**
   * Does this voice have a file for this language? If not, the language's default voice is used instead of failing the
   * call, and `onVoiceMissing` is told so the caller can warn the user.
   */
  voiceAvailable?: (providerVoiceId: string, language: PocketLanguage) => Promise<boolean>;
  onVoiceMissing?: (providerVoiceId: string, language: PocketLanguage) => void;
  fetch?: typeof fetch;
}

export class PocketTtsError extends ProviderError {
  constructor(message: string, status: number) {
    super(message, status, "pocket_tts");
  }
}

/** Built-in catalogue voices need no clone; anything else is a stored, consented clone. */
const BUILT_IN = new Set(["alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma", "anna", "vera", "charles", "paul", "george", "mary", "jane", "michael", "eve"]);
export const isBuiltInPocketVoice = (id: string) => BUILT_IN.has(id);

/** Hindi (Devanagari) sentences go to the Hindi model, everything else to the English one. */
export const detectPocketLanguage = (text: string): PocketLanguage => (/[\u0900-\u097F]/.test(text) ? "hi" : "en");

/**
 * Cuts a sentence into runs by script. The Hindi model cannot read English letters (it babbles) and the English model reads
 * Hindi letters poorly, so each run goes to the model that can read it. Punctuation, spaces and digits stay with the
 * run before them, so "जी, Business plan की कीमत" becomes ["जी, ", "Business plan ", "की कीमत"].
 */
export function splitByScript(text: string): Array<{ text: string; language: PocketLanguage }> {
  const runs: Array<{ text: string; language: PocketLanguage }> = [];
  for (const token of text.match(/\S+\s*/g) ?? []) {
    const hi = /[\u0900-\u097F]/.test(token), en = /[A-Za-z]/.test(token);
    const language: PocketLanguage | undefined = hi ? "hi" : en ? "en" : undefined;
    const last = runs[runs.length - 1];
    if (!language) { if (last) last.text += token; else runs.push({ text: token, language: "en" }); continue; } // punctuation or digits alone
    if (last && last.language === language) last.text += token; else runs.push({ text: token, language });
  }
  // A leading neutral token (such as an opening quote) has no language of its own: give it to the first real run.
  if (runs.length > 1 && !/[\p{L}]/u.test(runs[0]!.text)) { runs[1]!.text = runs[0]!.text + runs[1]!.text; runs.shift(); }
  return runs;
}

/** Kokoro voice names. Hindi voices are hm_ (male) and hf_ (female); the same-gender English voice keeps one sentence consistent. */
export const KOKORO_HINDI = { male: "hm_omega", female: "hf_alpha" } as const;
export const kokoroHindiVoiceFor = (gender: string | undefined) => (gender === "male" ? KOKORO_HINDI.male : KOKORO_HINDI.female);
const kokoroEnglishFor = (hindiVoice: string) => (hindiVoice.startsWith("hm_") ? "am_michael" : "af_heart");

/** File name stem for a voice in a language: the English file is plain, other languages add a suffix. */
export const voiceFileStem = (id: string, language: PocketLanguage) => (language === "en" ? id : `${id}.${language}`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Splits a (possibly chunked) WAV stream into PCM16 mono samples; the header can span chunks. */
async function* pcm16Stream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ rate: number; samples: Int16Array }> {
  const reader = body.getReader();
  let header: Uint8Array | null = new Uint8Array(0);
  let rate = 24_000;
  let carry: number | null = null; // odd trailing byte between chunks
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    let chunk: Uint8Array = value;
    if (header) {
      const merged: Uint8Array = new Uint8Array(header.length + chunk.length);
      merged.set(header); merged.set(chunk, header.length);
      // Find the "data" sub-chunk marker; everything after its 8-byte header is audio.
      const at = indexOfData(merged);
      if (at < 0) { header = merged; if (merged.length > 4096) throw new PocketTtsError("unexpected WAV header", 502); continue; }
      rate = new DataView(merged.buffer, merged.byteOffset).getUint32(24, true) || rate;
      chunk = merged.subarray(at + 8);
      header = null;
    }
    if (carry !== null) { const m = new Uint8Array(chunk.length + 1); m[0] = carry; m.set(chunk, 1); chunk = m; carry = null; }
    if (chunk.length % 2) { carry = chunk[chunk.length - 1]!; chunk = chunk.subarray(0, chunk.length - 1); }
    if (!chunk.length) continue;
    const copy = new Uint8Array(chunk); // realign to an even offset for Int16Array
    yield { rate, samples: new Int16Array(copy.buffer, 0, copy.length / 2) };
  }
}

function indexOfData(b: Uint8Array): number {
  for (let i = 12; i + 8 <= b.length; i++) if (b[i] === 0x64 && b[i + 1] === 0x61 && b[i + 2] === 0x74 && b[i + 3] === 0x61) return i;
  return -1;
}

/** 16-bit linear PCM to 8-bit G.711 µ-law. */
export function linearToMulaw(sample: number): number {
  const BIAS = 0x84, CLIP = 32635;
  let s = sample, sign = 0;
  if (s < 0) { s = -s; sign = 0x80; }
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

/** Averages groups of `factor` samples (a crude low-pass) then µ-law encodes: 24 kHz in, 8 kHz out when factor is 3. */
export function pcmToMulaw8k(samples: Int16Array, rate: number): Uint8Array {
  const factor = Math.max(1, Math.round(rate / 8000));
  const out = new Uint8Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[i * factor + k]!;
    out[i] = linearToMulaw(Math.round(sum / factor));
  }
  return out;
}

/** Self-hosted, free TTS and voice cloning (Kyutai Pocket TTS, MIT). Runs on CPU; see docs/POCKET_TTS.md. */
export function createPocketTts(config: PocketTtsConfig): TtsAdapter & SpeechSynthesizer & {
  cloneVoice(input: { label: string; samples: CloneSample[]; /** A separate recording in Hindi. Without it the Hindi voice is made from the English recording. */ hindiSample?: CloneSample }): Promise<{ providerVoiceId: string; languages: PocketLanguage[]; failed: { language: PocketLanguage; reason: string }[]; /** True when Hindi and Hinglish will be spoken in the person's own voice. */ hindiInOwnVoice: boolean }>;
  addLanguage(input: { providerVoiceId: string; language: PocketLanguage; sample: CloneSample }): Promise<void>;
  /** Native-quality streaming: 16-bit mono PCM at the model's own rate (24 kHz), for web playback. */
  synthesizePcm(input: { text: string; providerVoiceId: string; hindiVoice?: string; signal?: AbortSignal }): AsyncIterable<{ rate: number; samples: Int16Array }>;
} {
  const base = config.baseUrl.replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;

  const availability = new Map<string, { ok: boolean; at: number }>();
  const hasFile = async (id: string, language: PocketLanguage) => {
    if (!config.voiceAvailable) return true;
    const key = `${id}:${language}`, hit = availability.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.ok;
    const ok = await config.voiceAvailable(id, language).catch(() => false);
    availability.set(key, { ok, at: Date.now() });
    return ok;
  };

  const serverFor = (language: PocketLanguage): string => {
    if (language === "en") return base;
    const l = config.languages?.[language];
    if (!l) throw new PocketTtsError(`the ${language} voice model is not configured`, 501);
    return l.baseUrl.replace(/\/$/, "");
  };

  async function kokoroRequest(text: string, voice: string, lang: "hi" | "en-us", signal?: AbortSignal) {
    const res = await doFetch(`${config.kokoro!.baseUrl.replace(/\/$/, "")}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice, lang }), signal });
    if (!res.ok || !res.body) throw new PocketTtsError(`Hindi voice failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
    return res.body;
  }

  /**
   * Speaks a sentence run by run, each in the model that can read it. All runs are requested at once and read in order.
   * With Kokoro configured, a sentence containing Hindi is spoken wholly by Kokoro (Hindi runs in the Hindi voice, English runs
   * in the matching English voice) so the sentence has one consistent voice.
   */
  async function* sentencePcm(text: string, voiceId: string, signal?: AbortSignal, hindiVoice?: string): AsyncGenerator<{ rate: number; samples: Int16Array; hindiVoice?: "converted" | "built-in" }> {
    // With the Hindi engine, common English words in a Hindi sentence are spoken with Hindi sounds, not by an English voice.
    const runs = splitByScript(config.kokoro ? hinglishToDevanagari(text) : text);
    const hi = hindiVoice ?? KOKORO_HINDI.female;
    const useKokoro = !!config.kokoro && runs.some((r) => r.language === "hi");
    const ask = (r: { text: string; language: PocketLanguage }) => (useKokoro ? kokoroRequest(r.text, r.language === "hi" ? hi : kokoroEnglishFor(hi), r.language === "hi" ? "hi" : "en-us", signal) : request(r.text, voiceId, signal, r.language));
    if (useKokoro && config.convert && UUID.test(voiceId)) {
      // The whole sentence is made first, then changed to the person's voice in one go (one voice for the whole sentence).
      const bodies = runs.map(ask);
      bodies.forEach((b) => b.catch(() => {}));
      const parts: Int16Array[] = [];
      let rate = 24_000;
      for (const b of bodies) for await (const c of pcm16Stream(await b)) { rate = c.rate; parts.push(c.samples); }
      const all = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      try {
        const res = await doFetch(`${config.convert.baseUrl.replace(/\/$/, "")}/convert?id=${voiceId}`, {
          method: "POST", headers: { "content-type": "audio/wav" }, body: wavFromPcm16(new Uint8Array(all.buffer, 0, all.byteLength), rate) as unknown as BodyInit, signal,
        });
        if (!res.ok || !res.body) { config.onNotConverted?.(voiceId, res.status === 404 ? "no_fingerprint" : "unavailable"); throw new PocketTtsError(`voice conversion: ${res.status}`, res.status); }
        for await (const c of pcm16Stream(res.body)) yield { ...c, hindiVoice: "converted" };
        return;
      } catch (e) {
        if (signal?.aborted) throw e;
        if (!(e instanceof PocketTtsError)) config.onNotConverted?.(voiceId, "unavailable"); // server down or timed out
      }
      yield { rate, samples: all, hindiVoice: "built-in" }; // fall back to the built-in Hindi voice
      return;
    }
    if (runs.length <= 1) return yield* pcm16Stream(await (runs.length ? ask(runs[0]!) : request(text, voiceId, signal)));
    const bodies = runs.map(ask);
    bodies.forEach((b) => b.catch(() => {})); // an early failure must not become an unhandled rejection while an earlier run is playing
    for (const b of bodies) yield* pcm16Stream(await b);
  }

  async function request(text: string, voiceId: string, signal?: AbortSignal, forced?: PocketLanguage) {
    const language = forced ?? detectPocketLanguage(text);
    const server = serverFor(language);
    const form = new FormData();
    form.set("text", text);
    if (isBuiltInPocketVoice(voiceId)) {
      // Built-in names belong to the English model; other languages speak in their own default voice.
      if (language === "en") form.set("voice_url", voiceId);
    } else {
      if (!UUID.test(voiceId) || !config.voiceUrl) throw new PocketTtsError("unknown voice", 400);
      if (language === "en" || (await hasFile(voiceId, language))) form.set("voice_url", config.voiceUrl(voiceId, language));
      else config.onVoiceMissing?.(voiceId, language); // no file for this language: default voice for it, not an error
    }
    const res = await doFetch(`${server}/tts`, { method: "POST", body: form, signal });
    if (!res.ok || !res.body) throw new PocketTtsError(`Pocket TTS failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status);
    return res.body;
  }

  return {
    async *synthesizePcm({ text, providerVoiceId, hindiVoice, signal }) {
      yield* sentencePcm(text, providerVoiceId, signal, hindiVoice);
    },

    async *synthesize({ text, providerVoiceId, hindiVoice, signal }): AsyncGenerator<MulawFrame> {
      // Down-sampling needs whole groups of samples, so any remainder waits for the next chunk instead of being dropped.
      let rest = new Int16Array(0);
      for await (const { rate, samples } of sentencePcm(text, providerVoiceId, signal, hindiVoice)) {
        const factor = Math.max(1, Math.round(rate / 8000));
        const all = new Int16Array(rest.length + samples.length);
        all.set(rest); all.set(samples, rest.length);
        const whole = all.length - (all.length % factor);
        rest = all.slice(whole);
        if (whole) yield pcmToMulaw8k(all.subarray(0, whole), rate);
      }
    },

    async speak({ text, voiceId, hindiVoice, format = "mp3", signal }: { text: string; voiceId: string; hindiVoice?: string; format?: AudioFormat; signal?: AbortSignal }): Promise<SpeechResult> {
      const chunks: Uint8Array[] = [];
      let rate = 24_000;
      let via: "converted" | "built-in" | undefined;
      for await (const c of sentencePcm(text, voiceId, signal, hindiVoice)) { rate = c.rate; via = c.hindiVoice ?? via; chunks.push(new Uint8Array(c.samples.buffer, 0, c.samples.byteLength)); }
      const pcm = Buffer.concat(chunks);
      if (format === "mulaw8k") return { audio: pcmToMulaw8k(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2), rate), mime: "audio/basic", hindiVoice: via };
      return { audio: wavFromPcm16(pcm, rate), mime: "audio/wav", hindiVoice: via };
    },

    /** Samples must be WAV. One recording becomes a voice file per language; the raw audio is deleted afterwards. */
    async cloneVoice({ samples, hindiSample }): Promise<{ providerVoiceId: string; languages: PocketLanguage[]; failed: { language: PocketLanguage; reason: string }[]; hindiInOwnVoice: boolean }> {
      if (!config.binPath || !config.voicesDir) throw new PocketTtsError("cloning is not configured (POCKET_TTS_BIN, POCKET_TTS_VOICES_DIR)", 501);
      const sample = samples[0];
      if (!sample || samples.length !== 1) throw new PocketTtsError("send the recording as a single WAV file", 400);
      if (!isRiffWave(sample.data)) throw new PocketTtsError("the voice sample must be a WAV file", 400);
      const id = randomUUID();
      if (hindiSample && !isRiffWave(hindiSample.data)) throw new PocketTtsError("the Hindi voice sample must be a WAV file", 400);
      const { done, failed } = await exportAll(id, { en: sample.data, hi: hindiSample?.data }, ["en", ...(Object.keys(config.languages ?? {}) as PocketLanguage[])]);
      if (!done.includes("en")) throw new PocketTtsError(failed.find((f) => f.language === "en")?.reason ?? "voice export failed", 502);
      // The fingerprint that lets Hindi and Hinglish be spoken in this person's voice. If it cannot be made, the clone still works
      // in English and Hindi falls back to the built-in voice.
      let hindiInOwnVoice = false;
      if (config.convert) hindiInOwnVoice = await makeFingerprint(id, sample.data).then(() => true, (e: Error) => { failed.push({ language: "hi", reason: `voice fingerprint failed: ${e.message}` }); return false; });
      return { providerVoiceId: id, languages: done, failed, hindiInOwnVoice };
    },

    /** Gives an existing voice another language from a fresh recording (the old recording was deleted). */
    async addLanguage({ providerVoiceId, language, sample }: { providerVoiceId: string; language: PocketLanguage; sample: CloneSample }): Promise<void> {
      if (config.convert && language === "hi") {
        // With voice conversion, "adding Hindi" means making the voice fingerprint from a new recording.
        if (!UUID.test(providerVoiceId)) throw new PocketTtsError("unknown voice", 400);
        if (!isRiffWave(sample.data)) throw new PocketTtsError("the voice sample must be a WAV file", 400);
        return makeFingerprint(providerVoiceId, sample.data);
      }
      if (!config.binPath || !config.voicesDir) throw new PocketTtsError("cloning is not configured", 501);
      if (!UUID.test(providerVoiceId)) throw new PocketTtsError("unknown voice", 400);
      if (!isRiffWave(sample.data)) throw new PocketTtsError("the voice sample must be a WAV file", 400);
      const { done, failed } = await exportAll(providerVoiceId, { en: sample.data, hi: sample.data }, [language]);
      if (!done.includes(language)) throw new PocketTtsError(failed[0]?.reason ?? "voice export failed", 502);
      availability.delete(`${providerVoiceId}:${language}`);
    },

    /** Deletes every file belonging to the voice, whichever languages it was made with when it was created. */
    async deleteVoice(providerVoiceId: string): Promise<void> {
      if (!config.voicesDir || !UUID.test(providerVoiceId)) return;
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(config.voicesDir).catch(() => [] as string[]);
      await Promise.all(files.filter((f) => f === `${providerVoiceId}.safetensors` || f.startsWith(`${providerVoiceId}.`)).map((f) => rm(join(config.voicesDir!, f), { force: true })));
    },
  };

  /** Sends a recording to the conversion server, which stores the person's voice fingerprint. */
  async function makeFingerprint(id: string, wavData: Uint8Array): Promise<void> {
    const res = await doFetch(`${config.convert!.baseUrl.replace(/\/$/, "")}/embed?id=${id}`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wavData as unknown as BodyInit, signal: AbortSignal.timeout(60_000) }).catch((e: Error) => { throw new PocketTtsError(`voice conversion server is not running: ${e.message}`, 503); });
    if (!res.ok) throw new PocketTtsError(`voice fingerprint failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`, res.status);
  }

  /** Runs export-voice once per language model. The raw recording only ever exists in a temp folder removed at the end. */
  async function exportAll(id: string, recordings: Partial<Record<PocketLanguage, Uint8Array>>, wanted: PocketLanguage[]) {
    await mkdir(config.voicesDir!, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(tmpdir(), "voice-clone-"));
    const done: PocketLanguage[] = [], failed: { language: PocketLanguage; reason: string }[] = [];
    try {
      for (const language of wanted) {
        // Each language is made from a recording of that language when there is one, otherwise from the English recording.
        const data = recordings[language] ?? recordings.en!;
        const wav = join(dir, `sample-${language}.wav`);
        await writeFile(wav, data, { mode: 0o600 });
        const out = join(dir, `${language}.safetensors`);
        const args = ["export-voice", "--quiet", ...(language === "en" ? [] : config.languages?.[language]?.exportArgs ?? []), wav, out];
        try {
          await run(config.binPath!, args, { timeout: 180_000, env: process.env });
          const { copyFile } = await import("node:fs/promises");
          await copyFile(out, join(config.voicesDir!, `${voiceFileStem(id, language)}.safetensors`));
          done.push(language);
        } catch (e) {
          failed.push({ language, reason: `voice export failed: ${((e as { stderr?: string }).stderr ?? String(e)).slice(0, 300)}` });
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return { done, failed };
  }
}

const isRiffWave = (d: Uint8Array) => d.length > 44 && d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x41;

function wavFromPcm16(pcm: Uint8Array, rate: number): Uint8Array {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Signature for a stored voice file's web address. The web app and the voice service share the key. */
export const signVoiceFileId = (key: string, id: string) => createHmac("sha256", key).update(`voice-file:${id}`).digest("hex");

/** G.711 µ-law byte back to 16-bit linear PCM. */
export function mulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80, exp = (u >> 4) & 0x07, mant = u & 0x0f;
  const mag = (((mant << 3) + 0x84) << exp) - 0x84;
  return sign ? -mag : mag;
}
export function mulawToPcm16(frame: Uint8Array): Int16Array {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) out[i] = mulawToLinear(frame[i]!);
  return out;
}
