/**
 * Provider adapter interfaces (SOP: every external provider sits behind an adapter).
 * Implementations land in Phase 1 (tts) and Phase 2 (plivo, stt, askg1).
 * Voice cloning itself happens in the provider's consented clone flow; the platform registers the resulting voice id.
 */

/** Audio is 8 kHz µ-law end to end so Plivo needs no transcoding. */
export type MulawFrame = Uint8Array;

export interface TtsAdapter {
  /** Streams µ-law 8 kHz audio for `text` in the given provider voice. Abort the signal on barge-in. */
  synthesize(input: { text: string; providerVoiceId: string; signal?: AbortSignal }): AsyncIterable<MulawFrame>;
  /** Must complete within 24 h of consent withdrawal (SOP). */
  deleteVoice(providerVoiceId: string): Promise<void>;
}

export interface SttEvent {
  kind: "partial" | "final" | "speech_started" | "end_of_speech";
  text?: string;
  language?: string;
}

export interface SttSession {
  send(frame: MulawFrame): void;
  events: AsyncIterable<SttEvent>;
  close(): Promise<void>;
}

export interface SttAdapter {
  open(input: { language: "en" | "hi" | "en-hi" }): Promise<SttSession>;
}

export interface LlmAdapter {
  /** Streams reply tokens from AskG1; abort on barge-in. */
  respond(input: {
    transcript: string;
    leadContext: Record<string, unknown>;
    knowledge: string[];
    signal?: AbortSignal;
  }): AsyncIterable<string>;
}

export interface TelephonyAdapter {
  verifySignature(input: { url: string; nonce: string; signature: string; body: string }): boolean;
  transferCall(input: { callUuid: string; toNumber: string }): Promise<void>;
}

export * from "./elevenlabs";
