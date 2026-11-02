import { ProviderError, type SttAdapter, type SttEvent, type SttSession } from "./types";
import { Vad, type VadOptions } from "./vad";

export interface LocalWhisperConfig {
  /** Base URL of whisper.cpp's `whisper-server`, e.g. http://127.0.0.1:8767 */
  baseUrl: string;
  vad?: VadOptions;
  /**
   * "Only me" mode for rooms with other people. The first utterances set how loud the speaker is at the microphone;
   * speech clearly quieter than that (people further away) is ignored. `relativeGate` is the fraction of the speaker's
   * level below which speech is dropped.
   */
  closeMic?: { relativeGate?: number };
  /**
   * Transcripts Whisper is unsure of are dropped: mumbled background talk scores far below clear speech. Asking Whisper
   * for its confidence about twice as slow as plain text, so by default (`when: "quiet"`) it is asked only for
   * utterances quieter than the speaker's usual level, which is where background voices hide. `"always"` checks all.
   */
  minConfidence?: { avgLogprob?: number; noSpeechProb?: number; when?: "quiet" | "always" };
  /** Hints that help with names Whisper has never heard: the brand, in each script. */
  prompts?: { en?: string; hi?: string; auto?: string };
  fetch?: typeof fetch;
  /** Called with how long each transcription took, for latency tracking. */
  onTranscribed?: (info: { ms: number; speechMs: number; chars: number; avgLogprob?: number; noSpeechProb?: number; dropped?: string }) => void;
}

const LANG = { en: "en", hi: "hi", "en-hi": "auto" } as const;
// Hindi and mixed calls get the product words spelled the way they should be written. Measured on 24 spoken Hindi sentences: with only the
// brand name 19.0% of characters were wrong, with this list 5.1%; on sentences that share none of these words, 4.2% fell to 2.0%.
const HINDI_VOCAB = "बिज़नेस प्लान, स्टार्टर प्लान, डेमो, इस हफ़्ते डेमो चाहिए, कल, आज, परसों, कॉल रिकॉर्डिंग, कॉल रिकॉर्ड करते हैं, कीमत, कौन सी भाषाएँ बोलते हैं, यूज़र, रिपोर्ट";
const DEFAULT_PROMPTS = { en: "Bizfy", hi: `बिज़्फी। ${HINDI_VOCAB}।`, auto: `Bizfy, बिज़्फी। ${HINDI_VOCAB}।` };

/** Whisper invents words on silence and noise. These are the usual inventions on very short clips. */
const NOT_LETTERS = String.raw`[^\p{L}\p{M}\p{N}]*`; // not \W: in JavaScript \W also matches every Hindi letter, which made whole Hindi sentences look like noise
const PHANTOM = new RegExp(String.raw`^${NOT_LETTERS}(thank you|thanks for watching|thanks|you|bye|okay|ok|हम्म|धन्यवाद)${NOT_LETTERS}$`, "iu");
/** Breath, hush and filler sounds. Whisper writes them as words ("Shh.", "Hmm."), but they are never a question or an answer. */
const NOISE_SOUNDS = new RegExp(String.raw`^${NOT_LETTERS}(s+h+|h+u*s+h+|h+m+|m+h*m+|u+h+|u+m+|a+h+|o+h+|e+r+m*|h+u+h+|ugh|tsk|ha(ha)*|हम्म+|ऊं+|आ+ह+|श+)${NOT_LETTERS}$`, "iu");
/** A one-word Devanagari scrap on a very short clip is usually noise misheard as a word (e.g. "झाल"); real short answers are kept. */
const SHORT_HINDI_ANSWERS = new RegExp(String.raw`^${NOT_LETTERS}(हाँ|हां|हा|जी|नहीं|नही|ठीक|ठीक है|ओके|अच्छा|सही|बोलिए|हैलो|हेलो|नमस्ते)${NOT_LETTERS}$`, "u");
export function isPhantom(text: string, speechMs: number): boolean {
  const t = text.trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return true;
  if (NOISE_SOUNDS.test(t)) return true;
  if (speechMs < 450 && /^\p{Script=Devanagari}{1,4}$/u.test(t) && !SHORT_HINDI_ANSWERS.test(t)) return true;
  if (/^[\[(].*[\])]$/.test(t)) return true; // [BLANK_AUDIO], (music), (silence)
  return speechMs < 1200 && PHANTOM.test(t);
}

interface WhisperSegment { avg_logprob?: number; no_speech_prob?: number }

/** Average confidence over the segments Whisper returned; undefined if it returned none (older servers, tests). */
export function confidenceOf(segments: WhisperSegment[] | undefined): { avgLogprob: number; noSpeechProb: number } | undefined {
  const s = (segments ?? []).filter((x) => typeof x.avg_logprob === "number");
  if (!s.length) return undefined;
  return { avgLogprob: s.reduce((n, x) => n + (x.avg_logprob ?? 0), 0) / s.length, noSpeechProb: s.reduce((n, x) => n + (x.no_speech_prob ?? 0), 0) / s.length };
}

function wavFromPcm16(pcm: Int16Array, rate: number): Uint8Array {
  const data = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); h.setUint32(4, 36 + data.length, true); w(8, "WAVE"); w(12, "fmt "); h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true);
  h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, "data"); h.setUint32(40, data.length, true);
  const out = new Uint8Array(44 + data.length);
  out.set(new Uint8Array(h.buffer)); out.set(data, 44);
  return out;
}

/**
 * Free, local speech-to-text: our own voice-activity detector finds each utterance, and a Whisper model running on
 * this machine transcribes it. No partial transcripts, so interruptions are detected by the voice itself.
 */
export function createLocalWhisper(config: LocalWhisperConfig): SttAdapter {
  const base = config.baseUrl.replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;
  const prompts = { ...DEFAULT_PROMPTS, ...config.prompts };

  return {
    async open({ language, sampleRate = 16_000 }): Promise<SttSession> {
      if (sampleRate !== 16_000) throw new ProviderError("local speech-to-text expects 16 kHz audio", 400, "whisper");
      const vad = new Vad({ ...config.vad, sampleRate });
      const queue: SttEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const push = (e: SttEvent) => { queue.push(e); wake?.(); wake = null; };
      let chain: Promise<void> = Promise.resolve(); // transcribe one utterance at a time, in order
      const gate = config.closeMic ? (config.closeMic.relativeGate ?? 0.45) : 0;
      const minLogprob = config.minConfidence?.avgLogprob ?? -1.0, maxNoSpeech = config.minConfidence?.noSpeechProb ?? 0.6;
      let reference = 0;   // how loud the speaker has been so far
      let gatedInARow = 0; // if a lot is dropped in a row the speaker has probably moved: relearn their level

      const transcribe = async (pcm: Int16Array, speechMs: number, level: number) => {
        if (gate && reference > 0 && level < reference * gate) {
          if (++gatedInARow >= 3) { reference = 0; gatedInARow = 0; }
          config.onTranscribed?.({ ms: 0, speechMs, chars: 0, dropped: "too quiet: probably someone further away" });
          return;
        }
        const t0 = Date.now();
        const form = new FormData();
        form.set("file", new Blob([wavFromPcm16(pcm, sampleRate) as unknown as BlobPart], { type: "audio/wav" }), "utterance.wav");
        form.set("language", LANG[language]);
        // Short clips are where noise turns into invented words, so their confidence is always checked; long clear speech stays fast.
        const wantConfidence = !!config.minConfidence && (config.minConfidence.when === "always" || speechMs < 1500 || (reference > 0 && level < reference * 0.7));
        form.set("response_format", wantConfidence ? "verbose_json" : "json");
        form.set("temperature", "0.0");
        // The brand-name hint helps long English sentences but makes Whisper repeat itself on short ones ("thanks"), so English only uses it
        // on longer speech. The Hindi word list does not: on short Hindi phrases it cut the errors from 34.5% to 12.9%, so it starts earlier.
        if (speechMs >= (language === "en" ? 1800 : 600)) form.set("prompt", language === "en" ? prompts.en : language === "hi" ? prompts.hi : prompts.auto);
        const res = await doFetch(`${base}/inference`, { method: "POST", body: form });
        if (!res.ok) throw new ProviderError(`Whisper failed: ${res.status}`, res.status, "whisper");
        const body = (await res.json()) as { text?: string; segments?: WhisperSegment[] };
        const text = body.text?.replace(/\s+/g, " ").trim() ?? "";
        const conf = confidenceOf(body.segments);
        const unsure = !!conf && (conf.avgLogprob < minLogprob || conf.noSpeechProb > maxNoSpeech);
        const phantom = isPhantom(text, speechMs);
        config.onTranscribed?.({ ms: Date.now() - t0, speechMs, chars: text.length, ...conf, dropped: phantom ? "not speech" : unsure ? "low confidence" : undefined });
        if (phantom || unsure) return;
        if (gate) { reference = reference ? reference * 0.7 + level * 0.3 : level; gatedInARow = 0; }
        push({ kind: "final", text, language });
      };

      const handle = (events: ReturnType<Vad["push"]>) => {
        for (const e of events) {
          if (e.kind === "start") {
            // Interrupting the AI is a bigger deal than being heard: a voice clearly quieter than the speaker's must not cut it off.
            if (gate && reference > 0 && e.level < reference * gate) config.onTranscribed?.({ ms: 0, speechMs: 0, chars: 0, dropped: "quiet voice did not interrupt" });
            else push({ kind: "speech_started" });
          }
          else {
            // The first utterance sets the speaker's level straight away, so the next voice is judged against it even
            // before this one has been transcribed.
            if (gate && reference === 0) reference = e.level;
            chain = chain.then(() => transcribe(e.pcm, e.speechMs, e.level)).catch(() => { /* one bad utterance must not stop the call */ });
          }
        }
      };
      const end = () => { closed = true; wake?.(); wake = null; };

      return {
        send(frame) {
          if (closed) return;
          const bytes = frame as Uint8Array;
          handle(vad.push(new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.byteLength & ~1)))));
        },
        async close() {
          handle(vad.flush());
          await chain;
          end();
        },
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
