import { applyProsody, clampProsody, hinglishToDevanagari, createChatterbox, createMaya2, isNeutralProsody, mulawToPcm16, pcmToMulaw8k, type Prosody, type TtsAdapter, type createPocketTts } from "@voiceai/providers";
import type { TtsEngine } from "./pipeline";

const asBytes = (s: Int16Array) => new Uint8Array(s.buffer, s.byteOffset, s.byteLength);

/** Free self-hosted voice at the model's native 24 kHz quality, for the browser test. */
export function pocketPcmEngine(tts: ReturnType<typeof createPocketTts>, voiceId: string, hindiVoice?: string): TtsEngine {
  return {
    encoding: "linear16",
    rate: 24_000,
    async *speak(text, signal) {
      for await (const { samples } of tts.synthesizePcm({ text, providerVoiceId: voiceId, hindiVoice, signal })) yield asBytes(samples);
    },
  };
}

/** Free self-hosted voice as 8 kHz µ-law, exactly what the phone carrier wants. */
export function pocketMulawEngine(tts: ReturnType<typeof createPocketTts>, voiceId: string, hindiVoice?: string): TtsEngine {
  return { encoding: "mulaw", rate: 8000, speak: (text, signal) => tts.synthesize({ text, providerVoiceId: voiceId, hindiVoice, signal }) };
}

/**
 * ElevenLabs at 24 kHz PCM for the browser (the phone uses its 8 kHz µ-law). Flash v2.5 also speaks Hindi, with a first byte
 * of about 0.3 s, so Hindi needs no voice conversion. A 16-bit sample can be split across network chunks: only whole samples go out.
 */
export function elevenLabsPcmEngine(apiKey: string, voiceId: string, modelId = "eleven_flash_v2_5", doFetch: typeof fetch = fetch): TtsEngine {
  return {
    encoding: "linear16",
    rate: 24_000,
    async *speak(text, signal) {
      const res = await doFetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_24000`, {
        method: "POST", headers: { "xi-api-key": apiKey, "content-type": "application/json" }, body: JSON.stringify({ text, model_id: modelId }), signal,
      });
      if (!res.ok || !res.body) throw new Error(`ElevenLabs TTS failed: ${res.status}`);
      const reader = res.body.getReader();
      let odd: number | null = null;
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
  };
}

/** Any adapter that streams µ-law (Deepgram, ElevenLabs), decoded to PCM for the browser test. */
export function mulawAdapterAsPcm(tts: TtsAdapter, voiceId: string): TtsEngine {
  return {
    encoding: "linear16",
    rate: 8000,
    async *speak(text, signal) {
      for await (const frame of tts.synthesize({ text, providerVoiceId: voiceId, signal })) yield asBytes(mulawToPcm16(frame));
    },
  };
}

/** An adapter that already makes 8 kHz µ-law (Deepgram, ElevenLabs), used as it is: exactly what the phone carrier wants. */
export function mulawAdapterEngine(tts: TtsAdapter, voiceId: string): TtsEngine {
  return { encoding: "mulaw", rate: 8000, speak: (text, signal) => tts.synthesize({ text, providerVoiceId: voiceId, signal }) };
}

/**
 * Chatterbox Multilingual, run by scripts/chatterbox-server.py: Hindi and English made directly in the person's own voice from a
 * recording of them. Each sentence is written in Devanagari (Hindi) or Latin letters (English) and sent with that language.
 * It is much closer to the person than the stock Hindi voice plus voice conversion, but needs a GPU to run faster than real time.
 */
export function chatterboxEngine(baseUrl: string, voiceId: string, opts: { token?: string; voicesDir?: string; loadRecording?: (voiceId: string) => Promise<Uint8Array | null | undefined>; doFetch?: typeof fetch } = {}): TtsEngine {
  const client = createChatterbox({ baseUrl, token: opts.token, voicesDir: opts.voicesDir, loadRecording: opts.loadRecording, fetch: opts.doFetch });
  return {
    encoding: "linear16",
    rate: 24_000,
    async *speak(text, signal) {
      const wav = await client.wav(text, voiceId, { signal });
      const pcm = wav.subarray(44); // a 44-byte header, then 16-bit samples at 24 kHz
      const step = 24_000 / 4 * 2; // 250 ms of audio per chunk
      for (let i = 0; i < pcm.length; i += step) { if (signal.aborted) return; yield pcm.slice(i, Math.min(pcm.length, i + step)); }
    },
  };
}

/**
 * Maya 2 Native, run on a GPU (scripts/maya2-colab.ipynb): English, Hindi and Hinglish in the person's own voice, streamed as it is
 * generated, so the first sound starts in about 0.13 s (24 kHz, the same as the browser test expects).
 */
export function maya2Engine(baseUrl: string, voiceId: string, opts: { token?: string; voicesDir?: string; loadRecording?: (voiceId: string) => Promise<Uint8Array | null | undefined>; doFetch?: typeof fetch } = {}): TtsEngine {
  const client = createMaya2({ baseUrl, token: opts.token, voicesDir: opts.voicesDir, loadRecording: opts.loadRecording, fetch: opts.doFetch });
  return {
    encoding: "linear16",
    rate: 24_000,
    cacheKey: "maya2",
    async *speak(text, signal) {
      for await (const chunk of client.pcm(text, voiceId, signal)) { if (signal.aborted) return; yield chunk; }
    },
  };
}

/**
 * A voice's own speed and pitch, applied to each sentence once it is made. The sentence is held until it is complete (a time-stretch
 * needs the whole sentence), so a changed voice starts a moment later; a voice left at 1x / 0 is passed through untouched and streams as before.
 */
export function withProsody(engine: TtsEngine, prosody: Partial<Prosody>): TtsEngine {
  if (isNeutralProsody(prosody)) return engine;
  const c = clampProsody(prosody);
  return {
    ...engine,
    variant: `s${c.speed.toFixed(2)}p${c.pitch.toFixed(1)}`,
    async *speak(text, signal) {
      const parts: Uint8Array[] = [];
      for await (const chunk of engine.speak(text, signal)) parts.push(chunk);
      const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { bytes.set(p, at); at += p.length; }
      const pcm = engine.encoding === "mulaw" ? mulawToPcm16(bytes) : new Int16Array(bytes.buffer.slice(0, bytes.length & ~1));
      const shaped = applyProsody(pcm, engine.rate, prosody);
      const out = engine.encoding === "mulaw" ? pcmToMulaw8k(shaped, engine.rate) : asBytes(shaped);
      const step = engine.encoding === "mulaw" ? engine.rate / 4 : engine.rate / 4 * 2; // 250 ms per chunk
      for (let i = 0; i < out.length; i += step) { if (signal.aborted) return; yield out.slice(i, Math.min(out.length, i + step)); }
    },
  };
}
