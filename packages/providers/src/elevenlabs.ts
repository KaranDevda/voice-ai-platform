import { ProviderError, type AudioFormat, type MulawFrame, type SpeechResult, type SpeechSynthesizer, type TtsAdapter } from "./types";

export interface ElevenLabsConfig {
  apiKey: string;
  /** Override for a regional/residency host; ElevenLabs documents EU, India and Singapore hosts. */
  baseUrl?: string;
  /** Low-latency model. Confirm the current id for your plan before go-live. */
  modelId?: string;
  fetch?: typeof fetch;
}

/** Kept as a named subclass so callers and tests can match on it. */
export class ElevenLabsError extends ProviderError {
  constructor(message: string, status: number) {
    super(message, status, "elevenlabs");
  }
}

export interface CloneSample { name: string; mime: string; data: Uint8Array }

/** TTS adapter. Requests `ulaw_8000` so audio goes straight to Plivo with no transcoding. */
export function createElevenLabsTts(config: ElevenLabsConfig): TtsAdapter & SpeechSynthesizer & { cloneVoice(input: { label: string; samples: CloneSample[]; description?: string }): Promise<{ providerVoiceId: string }> } {
  const base = (config.baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const modelId = config.modelId ?? "eleven_flash_v2_5";
  const doFetch = config.fetch ?? fetch;
  const headers = { "xi-api-key": config.apiKey };

  return {
    async *synthesize({ text, providerVoiceId, signal }): AsyncGenerator<MulawFrame> {
      const res = await doFetch(
        `${base}/v1/text-to-speech/${encodeURIComponent(providerVoiceId)}/stream?output_format=ulaw_8000`,
        { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ text, model_id: modelId }), signal },
      );
      if (!res.ok || !res.body) throw new ElevenLabsError(`ElevenLabs TTS failed: ${res.status}`, res.status);

      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value?.length) yield value;
        }
      } finally {
        // Barge-in aborts the consumer; make sure the upstream request stops too.
        await reader.cancel().catch(() => {});
      }
    },

    async speak({ text, voiceId, format = "mp3", signal }: { text: string; voiceId: string; format?: AudioFormat; signal?: AbortSignal }): Promise<SpeechResult> {
      const fmt = format === "mulaw8k" ? "ulaw_8000" : "mp3_44100_128";
      const res = await doFetch(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${fmt}`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ text, model_id: modelId }), signal,
      });
      if (!res.ok) throw new ElevenLabsError(`ElevenLabs TTS failed: ${res.status}`, res.status);
      return { audio: new Uint8Array(await res.arrayBuffer()), mime: format === "mp3" ? "audio/mpeg" : "audio/basic" };
    },

    /** Instant voice clone from consented samples. Professional clones are made in the ElevenLabs dashboard. */
    async cloneVoice({ label, samples, description }) {
      const form = new FormData();
      form.set("name", label);
      if (description) form.set("description", description);
      for (const s of samples) form.append("files", new Blob([s.data as unknown as BlobPart], { type: s.mime }), s.name);
      const res = await doFetch(`${base}/v1/voices/add`, { method: "POST", headers, body: form });
      if (!res.ok) throw new ElevenLabsError(`ElevenLabs clone failed: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
      const body = (await res.json()) as { voice_id?: string };
      if (!body.voice_id) throw new ElevenLabsError("ElevenLabs returned no voice id", 502);
      return { providerVoiceId: body.voice_id };
    },

    async deleteVoice(providerVoiceId) {
      const res = await doFetch(`${base}/v1/voices/${encodeURIComponent(providerVoiceId)}`, { method: "DELETE", headers });
      // Already gone counts as success so a retried revocation is idempotent.
      if (!res.ok && res.status !== 404) throw new ElevenLabsError(`ElevenLabs delete failed: ${res.status}`, res.status);
    },
  };
}
