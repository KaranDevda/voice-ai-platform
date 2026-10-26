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
