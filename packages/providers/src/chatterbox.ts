import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hinglishToDevanagari } from "./hinglish";
import type { SpeechResult } from "./types";

export interface ChatterboxConfig {
  /** e.g. http://127.0.0.1:8771, or the address of the GPU machine running scripts/chatterbox-server.py */
  baseUrl: string;
  /** Shared secret; the server requires one when it listens on a network address. */
  token?: string;
  /** Where this machine keeps each person's recording (<id>.ref.wav). Sent to the server once if it does not have it. */
  voicesDir?: string;
  /** Finds a person's stored recording (the database); tried before the folder. */
  loadRecording?: (voiceId: string) => Promise<Uint8Array | null | undefined>;
  fetch?: typeof fetch;
}

/** The text a Chatterbox voice should be given: Hinglish typed in English letters becomes Devanagari plus English words. */
export const chatterboxText = (text: string) => hinglishToDevanagari(text);

/**
 * Client for scripts/chatterbox-server.py. Remembers which voices the server already has, and uploads a person's recording
 * the first time it is needed (so the GPU machine can be a different computer).
 */
export function createChatterbox(config: ChatterboxConfig) {
  const base = config.baseUrl.replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;
  const headers = (extra: Record<string, string> = {}) => ({ ...(config.token ? { authorization: `Bearer ${config.token}` } : {}), ...extra });
  const known = new Set<string>();

  async function ensureVoice(voiceId: string, signal?: AbortSignal): Promise<void> {
    if (known.has(voiceId)) return;
    const head = await doFetch(`${base}/voice/${voiceId}`, { method: "HEAD", headers: headers(), signal });
    if (head.status === 401) throw new Error("Chatterbox: wrong CHATTERBOX_TOKEN");
    if (head.ok) { known.add(voiceId); return; }
    const wav = (await config.loadRecording?.(voiceId).catch(() => null)) ?? (config.voicesDir ? await readFile(join(config.voicesDir, `${voiceId}.ref.wav`)).catch(() => null) : null);
    if (!wav) throw new Error("this voice has no saved reference recording; record it again to use it with Chatterbox");
    const put = await doFetch(`${base}/voice/${voiceId}`, { method: "PUT", headers: headers({ "content-type": "audio/wav" }), body: wav as unknown as BodyInit, signal });
    if (!put.ok) throw new Error(`Chatterbox could not store the recording: ${put.status}`);
    known.add(voiceId);
  }

  async function wav(text: string, voiceId: string, opts: { language?: "auto" | "en" | "hi"; signal?: AbortSignal } = {}): Promise<Uint8Array> {
    await ensureVoice(voiceId, opts.signal);
    const res = await doFetch(`${base}/tts`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ text: chatterboxText(text), voice_id: voiceId, language: opts.language ?? "auto" }), signal: opts.signal });
    if (res.status === 404) known.delete(voiceId); // the server lost the recording: upload it again next time
    if (!res.ok) throw new Error(`Chatterbox failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  return {
    ensureVoice, wav,
    async healthy(): Promise<boolean> { return doFetch(`${base}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false); },
    /** Same shape as the other engines' speak(), so the Studio can use it for any cloned voice. */
    async speak({ text, voiceId, signal }: { text: string; voiceId: string; signal?: AbortSignal }): Promise<SpeechResult> {
      return { audio: await wav(text, voiceId, { signal }), mime: "audio/wav" };
    },
  };
}
