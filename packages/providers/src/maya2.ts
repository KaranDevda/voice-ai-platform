import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hinglishToDevanagari } from "./hinglish";
import type { SpeechResult } from "./types";

export interface Maya2Config {
  /** Address of the Maya 2 server (python -m maya3.server), e.g. the link printed by scripts/maya2-colab.ipynb. */
  baseUrl: string;
  /** Shared secret; the notebook puts a token check in front of the server, which has none of its own. */
  token?: string;
  /** Finds a person's saved recording (the database); tried before the folder. */
  loadRecording?: (voiceId: string) => Promise<Uint8Array | null | undefined>;
  /** Folder holding <id>.ref.wav, if recordings are kept on disk. */
  voicesDir?: string;
  /** Whisper server (whisper.cpp /inference) used to write down what the reference clip says, which full cloning needs. Defaults to WHISPER_URL. */
  whisperUrl?: string;
  fetch?: typeof fetch;
}

/** Maya 2 reads Devanagari as Hindi and Latin letters as English. Roman Hindi is converted first, the same way Chatterbox gets it. */
export function maya2Text(text: string): { text: string; language: "hi" | "en" } {
  const converted = hinglishToDevanagari(text);
  return { text: converted, language: /[ऀ-ॿ]/.test(converted) ? "hi" : "en" };
}

const toBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** Maya 2 refuses a reference longer than 30 s and works best with 3-10 s. Cuts a PCM WAV down to its first `maxSeconds`; anything else is returned unchanged. */
export function trimWav(wav: Uint8Array, maxSeconds = 10): Uint8Array {
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (wav.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return wav;
  let byteRate = 0, blockAlign = 0, pos = 12;
  while (pos + 8 <= wav.byteLength) {
    const name = tag(pos), size = dv.getUint32(pos + 4, true);
    if (name === "fmt ") { byteRate = dv.getUint32(pos + 16, true); blockAlign = dv.getUint16(pos + 20, true); }
    if (name === "data") {
      if (!byteRate || !blockAlign) return wav;
      const available = Math.min(size, wav.byteLength - pos - 8);
      const keep = Math.min(available, Math.floor((maxSeconds * byteRate) / blockAlign) * blockAlign);
      if (keep >= available) return wav;
      const out = new Uint8Array(pos + 8 + keep);
      out.set(wav.subarray(0, pos + 8 + keep));
      const odv = new DataView(out.buffer);
      odv.setUint32(4, out.byteLength - 8, true);
      odv.setUint32(pos + 4, keep, true);
      return out;
    }
    pos += 8 + size + (size % 2);
  }
  return wav;
}

/**
 * Client for the Maya 2 Native server. A person's saved recording is registered once (speaker-embedding mode, because the app keeps
 * the recording but not a word-for-word transcript of it), then speech is requested with that voice id.
 */
export function createMaya2(config: Maya2Config) {
  const base = config.baseUrl.replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;
  const headers = (extra: Record<string, string> = {}) => ({ ...(config.token ? { authorization: `Bearer ${config.token}` } : {}), ...extra });
  const known = new Set<string>();
  /** Maya voice ids allow letters, digits, _ . - only. */
  const id = (voiceId: string) => `c_${voiceId.replace(/[^A-Za-z0-9_.-]/g, "_")}`.slice(0, 64);

  /** The words in the (trimmed) reference clip: a saved <id>.ref.txt next to the recording, else Whisper, saved for next time. */
  async function referenceText(voiceId: string, wav: Uint8Array): Promise<{ text: string; lang: "hi" | "en" } | null> {
    const side = config.voicesDir ? join(config.voicesDir, `${voiceId}.ref.txt`) : null;
    const lang = (t: string) => (/[ऀ-ॿ]/.test(t) ? "hi" : "en") as "hi" | "en";
    if (side) { const t = (await readFile(side, "utf8").catch(() => "")).trim(); if (t) return { text: t, lang: lang(t) }; }
    const whisper = config.whisperUrl ?? process.env.WHISPER_URL;
    if (!whisper) return null;
    try {
      const form = new FormData();
      form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "ref.wav");
      form.append("response_format", "json"); form.append("temperature", "0");
      const r = await doFetch(`${whisper.replace(/\/$/, "")}/inference`, { method: "POST", body: form });
      if (!r.ok) return null;
      const text = (((await r.json()) as { text?: string }).text ?? "").replace(/\s+/g, " ").trim();
      if (text.length < 8) return null;
      if (side) await writeFile(side, text).catch(() => {});
      return { text, lang: lang(text) };
    } catch { return null; }
  }

  async function ensureVoice(voiceId: string, signal?: AbortSignal): Promise<string> {
    const vid = id(voiceId);
    if (known.has(vid)) return vid;
    const list = await doFetch(`${base}/v1/voices`, { headers: headers(), signal });
    if (list.status === 401) throw new Error("Maya 2: wrong MAYA2_TOKEN");
    if (list.ok) {
      const data = (await list.json().catch(() => ({}))) as { voices?: { id: string }[] };
      if (data.voices?.some((v) => v.id === vid)) { known.add(vid); return vid; }
    }
    const full = (await config.loadRecording?.(voiceId).catch(() => null)) ?? (config.voicesDir ? await readFile(join(config.voicesDir, `${voiceId}.ref.wav`)).catch(() => null) : null);
    if (!full) throw new Error("this voice has no saved recording; record it again to use it with Maya 2");
    const wav = trimWav(full);
    const ref = await referenceText(voiceId, wav);
    // Full cloning (audio + what it says + its language) copies the voice far better than the speaker-embedding mode used when no transcript exists.
    const body = ref ? { voice_id: vid, ref_audio_b64: toBase64(wav), ref_text: ref.text, lang: ref.lang, mode: "icl_spk", replace: true }
      : { voice_id: vid, ref_audio_b64: toBase64(wav), mode: "spk", replace: true };
    const res = await doFetch(`${base}/v1/voices`, { method: "POST", headers: headers({ "content-type": "application/json" }), signal, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Maya 2 could not register the voice: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    known.add(vid);
    return vid;
  }

  async function request(text: string, voiceId: string, format: "wav" | "pcm", signal?: AbortSignal): Promise<Response> {
    const vid = await ensureVoice(voiceId, signal);
    const t = maya2Text(text);
    const res = await doFetch(`${base}/v1/audio/speech`, {
      method: "POST", headers: headers({ "content-type": "application/json" }), signal,
      body: JSON.stringify({ model: "maya3", input: t.text, voice: vid, language: t.language, response_format: format, normalize: true }),
    });
    if (res.status === 404 || res.status === 400) known.delete(vid); // the server restarted and lost the voice: register it again next time
    if (!res.ok) throw new Error(`Maya 2 failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return res;
  }

  return {
    ensureVoice,
    async wav(text: string, voiceId: string, signal?: AbortSignal): Promise<Uint8Array> {
      return new Uint8Array(await (await request(text, voiceId, "wav", signal)).arrayBuffer());
    },
    /** Raw 16-bit 24 kHz mono audio, yielded as it is generated: this is what makes the first sound start in about 0.13 s. */
    async *pcm(text: string, voiceId: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
      const res = await request(text, voiceId, "pcm", signal);
      if (!res.body) throw new Error("Maya 2 sent no audio");
      const reader = res.body.getReader();
      let odd: number | null = null; // a sample can be split across network chunks: only whole samples go out
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (!value?.length) continue;
          let bytes = value;
          if (odd !== null) { const joined = new Uint8Array(bytes.length + 1); joined[0] = odd; joined.set(bytes, 1); bytes = joined; odd = null; }
          if (bytes.length % 2) { odd = bytes[bytes.length - 1]!; bytes = bytes.subarray(0, bytes.length - 1); }
          if (bytes.length) yield bytes;
        }
      } finally { await reader.cancel().catch(() => {}); }
    },
    async healthy(): Promise<boolean> { return doFetch(`${base}/health`, { headers: headers(), signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false); },
    /** Same shape as the other engines' speak(), so the Studio can use it for any cloned voice. */
    async speak({ text, voiceId, signal }: { text: string; voiceId: string; signal?: AbortSignal }): Promise<SpeechResult> {
      return { audio: await this.wav(text, voiceId, signal), mime: "audio/wav" };
    },
  };
}
