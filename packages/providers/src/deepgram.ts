import {
  ProviderError,
  type AudioFormat,
  type SpeechResult,
  type SpeechSynthesizer,
  type Transcription,
  type TranscriptionAdapter,
  type TtsAdapter,
} from "./types";

export interface DeepgramConfig {
  apiKey: string;
  baseUrl?: string;
  /** Transcription model. nova-3 covers English, Hindi and English/Hindi code-switching ("multi"). */
  sttModel?: string;
  fetch?: typeof fetch;
}

const API = "https://api.deepgram.com";
/** Deepgram rejects TTS requests over 2,000 characters (HTTP 413). */
export const DEEPGRAM_TTS_MAX_CHARS = 2000;

interface DgWord { word: string; start: number; end: number; speaker?: number; punctuated_word?: string }
interface DgUtterance { start: number; end: number; transcript: string; speaker?: number }
interface DgResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{ detected_language?: string; alternatives?: Array<{ transcript?: string; words?: DgWord[] }> }>;
    utterances?: DgUtterance[];
  };
}

/** Pure parser, exported for tests: prefers utterances, falls back to grouping words by speaker. */
export function parseDeepgramTranscript(body: DgResponse): Transcription {
  const channel = body.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const text = alt?.transcript?.trim() ?? "";
  let segments: Transcription["segments"] = [];

  if (body.results?.utterances?.length) {
    segments = body.results.utterances.map((u) => ({ speaker: u.speaker ?? 0, startMs: Math.round(u.start * 1000), endMs: Math.round(u.end * 1000), text: u.transcript.trim() }));
  } else if (alt?.words?.length) {
    for (const w of alt.words) {
      const speaker = w.speaker ?? 0;
      const word = w.punctuated_word ?? w.word;
      const last = segments[segments.length - 1];
      if (last && last.speaker === speaker) { last.text += ` ${word}`; last.endMs = Math.round(w.end * 1000); }
      else segments.push({ speaker, startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000), text: word });
    }
  } else if (text) {
    segments = [{ speaker: 0, startMs: 0, endMs: Math.round((body.metadata?.duration ?? 0) * 1000), text }];
  }
  return { text, durationS: body.metadata?.duration ?? 0, language: channel?.detected_language, segments };
}

const authHeader = (key: string) => ({ authorization: `Token ${key}` });

export function createDeepgramStt(config: DeepgramConfig): TranscriptionAdapter {
  const base = (config.baseUrl ?? API).replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;
  return {
    async transcribe({ audio, mime, language = "auto", diarize = true, signal }) {
      const q = new URLSearchParams({ model: config.sttModel ?? "nova-3", smart_format: "true", punctuate: "true", utterances: "true", diarize: String(diarize) });
      if (language === "auto") q.set("detect_language", "true");
      else q.set("language", language);

      const res = await doFetch(`${base}/v1/listen?${q}`, {
        method: "POST",
        headers: { ...authHeader(config.apiKey), "content-type": mime || "application/octet-stream" },
        body: audio as unknown as BodyInit,
        signal,
      });
      if (!res.ok) throw new ProviderError(`Deepgram transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`, res.status, "deepgram");
      return parseDeepgramTranscript((await res.json()) as DgResponse);
    },
  };
}

/** Splits text on sentence or word boundaries so each piece fits the provider's per-request limit. */
export function splitForSpeech(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf("\n"));
    const at = cut > max * 0.4 ? cut + 1 : Math.max(window.lastIndexOf(" "), Math.floor(max * 0.8));
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function speakQuery(voiceId: string, format: AudioFormat) {
  const q = new URLSearchParams({ model: voiceId });
  if (format === "mulaw8k") { q.set("encoding", "mulaw"); q.set("sample_rate", "8000"); q.set("container", "none"); }
  return q;
}

export function createDeepgramTts(config: DeepgramConfig): SpeechSynthesizer & TtsAdapter {
  const base = (config.baseUrl ?? API).replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;

  const request = async (text: string, voiceId: string, format: AudioFormat, signal?: AbortSignal) => {
    const res = await doFetch(`${base}/v1/speak?${speakQuery(voiceId, format)}`, {
      method: "POST",
      headers: { ...authHeader(config.apiKey), "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) throw new ProviderError(`Deepgram speech failed (${res.status}): ${(await res.text()).slice(0, 200)}`, res.status, "deepgram");
    return res;
  };

  return {
    async speak({ text, voiceId, format = "mp3", signal }): Promise<SpeechResult> {
      // Long scripts are voiced piece by piece; concatenated MP3 frames and raw µ-law both play back seamlessly.
      const chunks: Uint8Array[] = [];
      for (const piece of splitForSpeech(text, DEEPGRAM_TTS_MAX_CHARS)) {
        chunks.push(new Uint8Array(await (await request(piece, voiceId, format, signal)).arrayBuffer()));
      }
      const audio = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) { audio.set(c, o); o += c.length; }
      return { audio, mime: format === "mp3" ? "audio/mpeg" : "audio/basic" };
    },

    async *synthesize({ text, providerVoiceId, signal }) {
      const res = await request(text, providerVoiceId, "mulaw8k", signal);
      if (!res.body) return;
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value?.length) yield value;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    },

    async deleteVoice() {
      // Stock voices are not cloned; nothing to delete.
    },
  };
}
