import { readFile } from "node:fs/promises";
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
  fetch?: typeof fetch;
}

/** Maya 2 reads Devanagari as Hindi and Latin letters as English. Roman Hindi is converted first, the same way Chatterbox gets it. */
export function maya2Text(text: string): { text: string; language: "hi" | "en" } {
  const converted = hinglishToDevanagari(text);
  return { text: converted, language: /[ऀ-ॿ]/.test(converted) ? "hi" : "en" };
}

const toBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

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
  const id = (voiceId: string) => `v_${voiceId.replace(/[^A-Za-z0-9_.-]/g, "_")}`.slice(0, 64);

  async function ensureVoice(voiceId: string, signal?: AbortSignal): Promise<string> {
    const vid = id(voiceId);
    if (known.has(vid)) return vid;
    const list = await doFetch(`${base}/v1/voices`, { headers: headers(), signal });
    if (list.status === 401) throw new Error("Maya 2: wrong MAYA2_TOKEN");
    if (list.ok) {
      const data = (await list.json().catch(() => ({}))) as { voices?: { id: string }[] };
      if (data.voices?.some((v) => v.id === vid)) { known.add(vid); return vid; }
    }
    const wav = (await config.loadRecording?.(voiceId).catch(() => null)) ?? (config.voicesDir ? await readFile(join(config.voicesDir, `${voiceId}.ref.wav`)).catch(() => null) : null);
    if (!wav) throw new Error("this voice has no saved recording; record it again to use it with Maya 2");
    const res = await doFetch(`${base}/v1/voices`, {
      method: "POST", headers: headers({ "content-type": "application/json" }), signal,
      body: JSON.stringify({ voice_id: vid, ref_audio_b64: toBase64(wav), mode: "spk", replace: true }),
    });
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
