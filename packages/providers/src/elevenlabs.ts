import type { MulawFrame, TtsAdapter } from "./index";

export interface ElevenLabsConfig {
  apiKey: string;
  /** Override for a regional/residency host; ElevenLabs documents EU, India and Singapore hosts. */
  baseUrl?: string;
  /** Low-latency model. Confirm the current id for your plan before go-live. */
  modelId?: string;
  fetch?: typeof fetch;
}

export class ElevenLabsError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/** TTS adapter. Requests `ulaw_8000` so audio goes straight to Plivo with no transcoding. */
export function createElevenLabsTts(config: ElevenLabsConfig): TtsAdapter {
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

    async deleteVoice(providerVoiceId) {
      const res = await doFetch(`${base}/v1/voices/${encodeURIComponent(providerVoiceId)}`, { method: "DELETE", headers });
      // Already gone counts as success so a retried revocation is idempotent.
      if (!res.ok && res.status !== 404) throw new ElevenLabsError(`ElevenLabs delete failed: ${res.status}`, res.status);
    },
  };
}
