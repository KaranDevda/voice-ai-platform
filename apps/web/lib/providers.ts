import "server-only";
import { existsSync } from "node:fs";
import { headers } from "next/headers";
import { join } from "node:path";
import {
  createAskG1, createChatterbox, createDeepgramStt, createDeepgramTts, createElevenLabsTts, createPocketTts, kokoroHindiVoiceFor, ProviderError, signVoiceFileId, STOCK_VOICES, stockVoiceById,
  voiceFileStem,
} from "@voiceai/providers";
import type { SpeechSynthesizer } from "@voiceai/providers";
import { getVoiceSampleForEngine, logUsage, resolveCallVoice } from "@voiceai/db";
import type { AuthUser } from "@voiceai/auth";
import { getDb } from "./server";

export class NotConfiguredError extends Error {
  constructor(public readonly provider: string, public readonly hint: string) {
    super(`${provider} is not configured`);
  }
}

const env = (k: string) => process.env[k]?.trim() || undefined;

export function deepgramKey() {
  const apiKey = env("DEEPGRAM_API_KEY");
  if (!apiKey) throw new NotConfiguredError("deepgram", "Add DEEPGRAM_API_KEY to apps/web/.env.local");
  return apiKey;
}
export const getStt = () => createDeepgramStt({ apiKey: deepgramKey() });
export const getStockTts = () => createDeepgramTts({ apiKey: deepgramKey() });

export function getElevenLabs() {
  const apiKey = env("ELEVENLABS_API_KEY");
  if (!apiKey) throw new NotConfiguredError("elevenlabs", "Add ELEVENLABS_API_KEY to apps/web/.env.local");
  return createElevenLabsTts({ apiKey, baseUrl: env("ELEVENLABS_BASE_URL"), modelId: env("ELEVENLABS_MODEL_ID") });
}

/** Where exported clone voice files live. Gitignored: a voice file is biometric data. */
export const voicesDir = () => env("POCKET_TTS_VOICES_DIR") ?? join(process.cwd(), "../../.local/voices");

/** Signature for a voice file name stem (the voice id, plus ".hi" for the Hindi file). */
export function signVoiceId(stem: string): string {
  const key = env("VOICE_FILE_SECRET") ?? env("SESSION_SECRET");
  if (!key) throw new NotConfiguredError("voice files", "Set SESSION_SECRET (or VOICE_FILE_SECRET) in apps/web/.env.local");
  return signVoiceFileId(key, stem);
}

/**
 * Where the voice server fetches a person's voice file from: this very web server, whichever port it is on. A fixed address
 * broke as soon as the app ran on a different port, or two copies were running, and the voice server got a 404.
 * POCKET_TTS_VOICE_BASE_URL overrides it for deployments where the voice server reaches the app another way.
 */
async function ownBaseUrl(): Promise<string> {
  const fixed = env("POCKET_TTS_VOICE_BASE_URL");
  if (fixed) return fixed;
  try {
    const host = (await headers()).get("host");
    if (host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`; // only the local machine is trusted here
  } catch { /* not inside a request */ }
  return "http://127.0.0.1:3000";
}

export function getPocketTts(filesBaseUrl?: string) {
  const baseUrl = env("POCKET_TTS_URL");
  if (!baseUrl) throw new NotConfiguredError("pocket_tts", "Run `pnpm dev:tts` and set POCKET_TTS_URL=http://127.0.0.1:8765 in apps/web/.env.local");
  const filesBase = (filesBaseUrl ?? env("POCKET_TTS_VOICE_BASE_URL") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  // Hindi: Kokoro when it is running (reliable, fixed voices), otherwise the Pocket Hindi model (can clone, but unreliable).
  const kokoroUrl = env("KOKORO_URL");
  const hiUrl = kokoroUrl ? undefined : env("POCKET_TTS_HI_URL"), hiConfig = env("POCKET_TTS_HI_CONFIG");
  return createPocketTts({
    baseUrl,
    // Hindi is its own model: it speaks through its own server and needs its own voice file for each person.
    kokoro: kokoroUrl ? { baseUrl: kokoroUrl } : undefined,
    convert: kokoroUrl && env("VOICE_CONVERT_URL") ? { baseUrl: env("VOICE_CONVERT_URL")! } : undefined,
    languages: hiUrl ? { hi: { baseUrl: hiUrl, exportArgs: hiConfig ? ["--config", hiConfig] : [] } } : undefined,
    binPath: env("POCKET_TTS_BIN"),
    voicesDir: voicesDir(),
    // A voice made before Hindi was set up has no Hindi file: speak in the default Hindi voice instead of failing.
    voiceAvailable: async (id, language) => existsSync(join(voicesDir(), `${voiceFileStem(id, language)}.safetensors`)),
    voiceUrl: (id, language) => {
      const stem = voiceFileStem(id, language);
      return `${filesBase}/api/internal/voice-files/${signVoiceId(stem)}/${stem}.safetensors`;
    },
  });
}

/** Which engine creates new clones: the free self-hosted one when configured, else ElevenLabs. */
export const cloneProvider = (): "pocket_tts" | "elevenlabs" =>
  env("CLONE_PROVIDER") === "elevenlabs" ? "elevenlabs" : env("CLONE_PROVIDER") === "pocket_tts" || env("POCKET_TTS_URL") ? "pocket_tts" : "elevenlabs";

/** Hindi and Hinglish are spoken by a built-in Hindi voice (Kokoro), not by the person's own clone. */
export const builtInHindi = () => !!env("KOKORO_URL");
/** Hindi and Hinglish can also be changed into the cloned person's own voice (needs the voice-conversion server). */
export const hindiConversionOn = () => !!env("KOKORO_URL") && !!env("VOICE_CONVERT_URL");
/** True when this voice has the fingerprint that lets Hindi be spoken in its own voice. */
export const hasFingerprint = (providerVoiceId: string) => existsSync(join(voicesDir(), `${providerVoiceId}.se.pt`));

export const cloningReady = () => (cloneProvider() === "pocket_tts" ? !!env("POCKET_TTS_URL") && !!env("POCKET_TTS_BIN") : !!env("ELEVENLABS_API_KEY"));

export function getLlm() {
  const apiKey = env("ASKG1_API_KEY");
  const baseUrl = env("ASKG1_BASE_URL");
  if (!apiKey || !baseUrl) throw new NotConfiguredError("askg1", "Add ASKG1_API_KEY and ASKG1_BASE_URL to apps/web/.env.local");
  return createAskG1({ apiKey, baseUrl, model: env("ASKG1_MODEL") });
}

/** Runs a provider call, records latency, outcome and units in provider_usage, and rethrows failures. */
export async function timed<T>(user: AuthUser, provider: string, operation: string, fn: () => Promise<T>, units?: (r: T) => number): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    await logUsage(getDb(), { orgId: user.orgId, userId: user.id, provider, operation, status: "ok", latencyMs: Date.now() - t0, units: units?.(result) });
    return result;
  } catch (err) {
    await logUsage(getDb(), { orgId: user.orgId, userId: user.id, provider, operation, status: "error", latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export interface VoiceOption { ref: string; name: string; gender: string; group: "cloned" | "stock"; provider: string; detail: string; /** can speak Hindi and Hinglish */ hindi: boolean; /** Hindi and Hinglish are changed into this person's own voice */ hindiOwn?: boolean }

/** A voice reference is "dg:<aura id>" for stock voices or "profile:<uuid>" for a consented clone. */
export const highQualityReady = () => !!env("CHATTERBOX_URL");

/** `opts.highQuality`: use Chatterbox (a more natural voice, about 5 times slower than real time) for a cloned voice. Off by default: normal speech stays fast. */
export async function resolveVoice(user: AuthUser, ref: string, opts: { highQuality?: boolean } = {}): Promise<{ speak: SpeechSynthesizer; voiceId: string; provider: string; hindiVoice?: string; prosody?: { speed: number; pitch: number } }> {
  if (ref.startsWith("dg:")) {
    const id = ref.slice(3);
    if (!stockVoiceById(id)) throw new RangeError("unknown voice");
    return { speak: getStockTts(), voiceId: id, provider: "deepgram" };
  }
  if (ref.startsWith("profile:")) {
    // Throws if the profile is revoked or missing, so a withdrawn voice can never be used.
    const profile = await resolveCallVoice(getDb(), user.orgId, { voiceProfileId: ref.slice(8) });
    if (profile.provider !== "elevenlabs" && profile.provider !== "pocket_tts") throw new RangeError("unsupported voice provider");
    // Seeded demo profiles have placeholder ids that ElevenLabs does not know.
    if (profile.providerVoiceId.startsWith("demo-voice-")) throw new RangeError("This is a demo voice with no real ElevenLabs clone behind it. Clone a real staff voice in Voice clone, or pick a stock voice.");
    if (profile.provider === "pocket_tts" && env("CHATTERBOX_URL") && opts.highQuality) {
      // Open-source realistic voice: English, Hindi and Hinglish directly in the person's own voice. If the GPU machine is not
      // answering, the built-in engine speaks instead and the result says so (it never fails silently or sounds different unannounced).
      const chatterbox = createChatterbox({ baseUrl: env("CHATTERBOX_URL")!, token: env("CHATTERBOX_TOKEN"), voicesDir: voicesDir(), loadRecording: (id) => getVoiceSampleForEngine(getDb(), user.orgId, id) });
      const pocket = getPocketTts(await ownBaseUrl());
      return {
        provider: "chatterbox", voiceId: profile.providerVoiceId, hindiVoice: kokoroHindiVoiceFor(profile.gender), prosody: { speed: profile.speed, pitch: profile.pitch },
        speak: {
          async speak(input) {
            try { return { ...(await chatterbox.speak(input)), engine: "chatterbox" as const }; }
            catch (e) { return { ...(await pocket.speak(input)), engine: "fallback" as const, note: `Chatterbox could not be used (${e instanceof Error ? e.message : String(e)}), so the built-in voice engine spoke instead.` }; }
          },
        },
      };
    }
    return profile.provider === "pocket_tts"
      ? { speak: getPocketTts(await ownBaseUrl()), voiceId: profile.providerVoiceId, provider: "pocket_tts", hindiVoice: kokoroHindiVoiceFor(profile.gender), prosody: { speed: profile.speed, pitch: profile.pitch } }
      : { speak: getElevenLabs(), voiceId: profile.providerVoiceId, provider: "elevenlabs" };
  }
  throw new RangeError("unknown voice");
}

export const stockVoiceOptions = (): VoiceOption[] =>
  STOCK_VOICES.map((v) => ({ ref: `dg:${v.id}`, name: v.name, gender: v.gender, group: "stock", provider: "deepgram", detail: `${v.accent} · ${v.trait}`, hindi: false }));

export interface ProviderStatus { configured: boolean; reachable: boolean | null; note: string }

async function probe(url: string, init: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(2500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Configuration and reachability for the launchpad status chips. Never throws, never exposes keys. */
export async function checkProviders(): Promise<Record<"deepgram" | "elevenlabs" | "pocket_tts" | "askg1", ProviderStatus>> {
  const dg = env("DEEPGRAM_API_KEY");
  const el = env("ELEVENLABS_API_KEY");
  const g1 = env("ASKG1_API_KEY") && env("ASKG1_BASE_URL");
  const pt = env("POCKET_TTS_URL");
  const [dgOk, g1Ok, ptOk] = await Promise.all([
    dg ? probe("https://api.deepgram.com/v1/projects", { headers: { authorization: `Token ${dg}` } }) : null,
    g1 ? probe(env("ASKG1_BASE_URL")!, { method: "GET" }) : null,
    pt ? probe(`${pt.replace(/\/$/, "")}/health`, { method: "GET" }) : null,
  ]);
  return {
    deepgram: { configured: !!dg, reachable: dgOk, note: dg ? (dgOk ? "Transcription and stock voices ready" : "Key set but Deepgram did not answer") : "No API key" },
    elevenlabs: { configured: !!el, reachable: el ? true : null, note: el ? "Voice cloning ready" : "No API key: cloned voices are unavailable" },
    pocket_tts: { configured: !!pt, reachable: ptOk, note: !pt ? "Not configured: free self-hosted voices are off" : ptOk ? (env("POCKET_TTS_BIN") ? "Free voice cloning ready" : "Running; set POCKET_TTS_BIN to enable cloning") : "Not running: start it with pnpm dev:tts" },
    askg1: { configured: !!g1, reachable: g1Ok, note: !g1 ? "Not configured" : g1Ok ? "Reachable" : "Not reachable: connect the company VPN" },
  };
}

export { ProviderError };
