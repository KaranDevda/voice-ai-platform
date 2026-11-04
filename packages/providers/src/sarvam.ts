import { ProviderError, type SttAdapter, type SttEvent, type SttSession } from "./types";
import { Vad, type VadOptions } from "./vad";

/** Sarvam AI (Indian-language speech). https://docs.sarvam.ai: speech-to-text `saarika`, text-to-speech `bulbul`. */
const API = "https://api.sarvam.ai";
export const SARVAM_STT_MODEL = "saarika:v2.5";
export const SARVAM_TTS_MODEL = "bulbul:v3";
/** Speakers of bulbul:v3 (a sample; the API lists them all in its error for an unknown name). */
export const SARVAM_SPEAKERS = { female: ["priya", "ritu", "neha", "pooja", "kavya", "ishita", "shreya"], male: ["shubh", "aditya", "rahul", "amit", "dev", "rohan", "kabir"] } as const;
export const sarvamSpeakerFor = (gender: string | undefined) => (gender === "male" ? "shubh" : "priya");

function wavFromPcm16(pcm: Int16Array, rate: number): Uint8Array {
  const data = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = new Uint8Array(44), v = new DataView(h.buffer);
  h.set([0x52, 0x49, 0x46, 0x46]); v.setUint32(4, 36 + data.length, true); h.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); h.set([0x64, 0x61, 0x74, 0x61], 36); v.setUint32(40, data.length, true);
  const out = new Uint8Array(44 + data.length); out.set(h); out.set(data, 44); return out;
}

export interface SarvamSttConfig { apiKey: string; vad?: VadOptions; model?: string; fetch?: typeof fetch; onTranscribed?: (info: { ms: number; speechMs: number; chars: number }) => void }

/**
 * Speech-to-text in the cloud for Hindi, English and mixed speech. Our own voice detector finds each utterance (as with local Whisper)
 * and Sarvam writes it down. Caller audio leaves this machine: not for private-AI clients.
 */
export function createSarvamStt(config: SarvamSttConfig): SttAdapter {
  const doFetch = config.fetch ?? fetch;
  const LANG = { en: "en-IN", hi: "hi-IN", "en-hi": "unknown" } as const;
  return {
    async open({ language, sampleRate = 16_000 }): Promise<SttSession> {
      if (sampleRate !== 16_000) throw new ProviderError("Sarvam speech-to-text is used with 16 kHz audio here", 400, "sarvam");
      const vad = new Vad({ ...config.vad, sampleRate });
      const queue: SttEvent[] = [];
      let wake: (() => void) | null = null, closed = false;
      const push = (e: SttEvent) => { queue.push(e); wake?.(); wake = null; };
      let chain: Promise<void> = Promise.resolve();
      const transcribe = async (pcm: Int16Array, speechMs: number) => {
        const t0 = Date.now();
        const form = new FormData();
        form.set("file", new Blob([wavFromPcm16(pcm, sampleRate) as unknown as BlobPart], { type: "audio/wav" }), "utterance.wav");
        form.set("model", config.model ?? SARVAM_STT_MODEL);
        form.set("language_code", LANG[language]);
        const res = await doFetch(`${API}/speech-to-text`, { method: "POST", headers: { "api-subscription-key": config.apiKey }, body: form });
        if (!res.ok) throw new ProviderError(`Sarvam speech-to-text failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`, res.status, "sarvam");
        const body = (await res.json()) as { transcript?: string };
        const text = body.transcript?.replace(/\s+/g, " ").trim() ?? "";
        config.onTranscribed?.({ ms: Date.now() - t0, speechMs, chars: text.length });
        if (text) push({ kind: "final", text, language });
      };
      const handle = (events: ReturnType<Vad["push"]>) => {
        for (const e of events) {
          if (e.kind === "start") push({ kind: "speech_started" });
          else chain = chain.then(() => transcribe(e.pcm, e.speechMs)).catch(() => { /* one bad utterance must not stop the call */ });
        }
      };
      return {
        send(frame) {
          if (closed) return;
          const bytes = frame as Uint8Array;
          handle(vad.push(new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.byteLength & ~1)))));
        },
        async close() { handle(vad.flush()); await chain; closed = true; wake?.(); wake = null; },
        events: {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              while (queue.length) yield queue.shift()!;
              if (closed) return;
              await new Promise<void>((r) => { wake = r; });
            }
          },
        },
      };
    },
  };
}

export interface SarvamTtsConfig { apiKey: string; model?: string; fetch?: typeof fetch }

/** Whole-sentence text-to-speech: 24 kHz 16-bit mono PCM. Devanagari text is spoken as Hindi, anything else as Indian English. */
export function createSarvamTts(config: SarvamTtsConfig) {
  const doFetch = config.fetch ?? fetch;
  return {
    async speakPcm(input: { text: string; speaker: string; signal?: AbortSignal }): Promise<{ rate: number; samples: Int16Array }> {
      const lang = /[ऀ-ॿ]/.test(input.text) ? "hi-IN" : "en-IN";
      const res = await doFetch(`${API}/text-to-speech`, {
        method: "POST", headers: { "api-subscription-key": config.apiKey, "content-type": "application/json" }, signal: input.signal,
        body: JSON.stringify({ text: input.text, target_language_code: lang, speaker: input.speaker, model: config.model ?? SARVAM_TTS_MODEL, speech_sample_rate: 24000 }),
      });
      if (!res.ok) throw new ProviderError(`Sarvam text-to-speech failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`, res.status, "sarvam");
      const body = (await res.json()) as { audios?: string[] };
      const wav = Buffer.from(body.audios?.[0] ?? "", "base64");
      if (wav.length < 44) throw new ProviderError("Sarvam returned no audio", 502, "sarvam");
      const rate = wav.readUInt32LE(24);
      const at = wav.indexOf("data", 12, "latin1");
      const pcm = wav.subarray(at + 8);
      return { rate, samples: new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length & ~1))) };
    },
  };
}
