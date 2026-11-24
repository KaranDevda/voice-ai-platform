/**
 * Provider adapter interfaces (SOP: every external provider sits behind an adapter).
 * Voice cloning happens in the provider's consented clone flow; the platform registers the resulting voice id.
 */

/** Audio is 8 kHz µ-law end to end on live calls so Plivo needs no transcoding. */
export type MulawFrame = Uint8Array;

export class ProviderError extends Error {
  constructor(message: string, public readonly status: number, public readonly provider: string) {
    super(message);
  }
}

/** Streaming TTS for live calls: abort the signal on barge-in. */
export interface TtsAdapter {
  synthesize(input: { text: string; providerVoiceId: string; /** Built-in Hindi voice to use for Hindi text, if the engine has one (matched to the speaker's gender). */ hindiVoice?: string; signal?: AbortSignal }): AsyncIterable<MulawFrame>;
  /** Must complete within 24 h of consent withdrawal (SOP). */
  deleteVoice(providerVoiceId: string): Promise<void>;
}

export type AudioFormat = "mp3" | "mulaw8k";
export interface SpeechResult {
  audio: Uint8Array;
  mime: string;
  /** For Hindi and Hinglish from the self-hosted engine: "converted" = changed to the person's own voice, "built-in" = the built-in Hindi voice. */
  hindiVoice?: "converted" | "built-in";
  /** "chatterbox" = made directly in the person's voice; "fallback" = Chatterbox was set up but failed, so the built-in engine spoke (reason in `note`). */
  engine?: "chatterbox" | "fallback";
  note?: string;
}

/** Whole-clip TTS for the studio, library previews and the agent console. */
export interface SpeechSynthesizer {
  speak(input: { text: string; voiceId: string; hindiVoice?: string; format?: AudioFormat; signal?: AbortSignal }): Promise<SpeechResult>;
}

export interface TranscriptSegmentOut { speaker: number; startMs: number; endMs: number; text: string }
export interface Transcription {
  text: string;
  durationS: number;
  language?: string;
  segments: TranscriptSegmentOut[];
}

/** Whole-file speech-to-text for uploads and recordings. */
export interface TranscriptionAdapter {
  transcribe(input: {
    audio: Uint8Array;
    mime: string;
    language?: "auto" | "en" | "hi" | "multi";
    diarize?: boolean;
    signal?: AbortSignal;
  }): Promise<Transcription>;
}

export interface SttEvent {
  kind: "partial" | "final" | "speech_started" | "end_of_speech";
  text?: string;
  language?: string;
  /** end_of_speech only: how long ago the caller actually stopped (the silence the recogniser waited for before deciding). */
  trailingSilenceMs?: number;
}

export interface SttSession {
  send(frame: MulawFrame): void;
  events: AsyncIterable<SttEvent>;
  close(): Promise<void>;
}

/** Live streaming STT for calls (Phase 2). Telephony sends 8 kHz µ-law; the browser test sends 16 kHz linear PCM. */
export interface SttAdapter {
  open(input: { language: "en" | "hi" | "en-hi"; encoding?: "mulaw" | "linear16"; sampleRate?: number }): Promise<SttSession>;
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface LlmAdapter {
  /** Streams reply tokens from AskG1; abort on barge-in. */
  respond(input: {
    transcript: string;
    leadContext: Record<string, unknown>;
    knowledge: string[];
    signal?: AbortSignal;
  }): AsyncIterable<string>;
  /** Multi-turn chat for the agent console. */
  chat(input: { messages: ChatMessage[]; signal?: AbortSignal }): AsyncIterable<string>;
}

export interface TelephonyAdapter {
  verifySignature(input: { url: string; nonce: string; signature: string; body: string }): boolean;
  transferCall(input: { callUuid: string; toNumber: string }): Promise<void>;
}
