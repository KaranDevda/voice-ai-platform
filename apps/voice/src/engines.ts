import { mulawToPcm16, type TtsAdapter, type createPocketTts } from "@voiceai/providers";
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
