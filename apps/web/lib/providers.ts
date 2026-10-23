import "server-only";
import {
  createAskG1, createDeepgramStt, createDeepgramTts, createElevenLabsTts, ProviderError, STOCK_VOICES, stockVoiceById,
} from "@voiceai/providers";
import { logUsage, resolveCallVoice } from "@voiceai/db";
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

export interface VoiceOption { ref: string; name: string; gender: string; group: "cloned" | "stock"; provider: string; detail: string }

/** A voice reference is "dg:<aura id>" for stock voices or "profile:<uuid>" for a consented clone. */
export async function resolveVoice(user: AuthUser, ref: string): Promise<{ speak: ReturnType<typeof getStockTts> | ReturnType<typeof getElevenLabs>; voiceId: string; provider: string }> {
  if (ref.startsWith("dg:")) {
    const id = ref.slice(3);
    if (!stockVoiceById(id)) throw new RangeError("unknown voice");
    return { speak: getStockTts(), voiceId: id, provider: "deepgram" };
  }
  if (ref.startsWith("profile:")) {
    // Throws if the profile is revoked or missing, so a withdrawn voice can never be used.
    const profile = await resolveCallVoice(getDb(), user.orgId, { voiceProfileId: ref.slice(8) });
    if (profile.provider !== "elevenlabs") throw new RangeError("unsupported voice provider");
    return { speak: getElevenLabs(), voiceId: profile.providerVoiceId, provider: "elevenlabs" };
  }
  throw new RangeError("unknown voice");
}

export const stockVoiceOptions = (): VoiceOption[] =>
  STOCK_VOICES.map((v) => ({ ref: `dg:${v.id}`, name: v.name, gender: v.gender, group: "stock", provider: "deepgram", detail: `${v.accent} · ${v.trait}` }));

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
export async function checkProviders(): Promise<Record<"deepgram" | "elevenlabs" | "askg1", ProviderStatus>> {
  const dg = env("DEEPGRAM_API_KEY");
  const el = env("ELEVENLABS_API_KEY");
  const g1 = env("ASKG1_API_KEY") && env("ASKG1_BASE_URL");
  const [dgOk, g1Ok] = await Promise.all([
    dg ? probe("https://api.deepgram.com/v1/projects", { headers: { authorization: `Token ${dg}` } }) : null,
    g1 ? probe(env("ASKG1_BASE_URL")!, { method: "GET" }) : null,
  ]);
  return {
    deepgram: { configured: !!dg, reachable: dgOk, note: dg ? (dgOk ? "Transcription and stock voices ready" : "Key set but Deepgram did not answer") : "No API key" },
    elevenlabs: { configured: !!el, reachable: el ? true : null, note: el ? "Voice cloning ready" : "No API key: cloned voices are unavailable" },
    askg1: { configured: !!g1, reachable: g1Ok, note: !g1 ? "Not configured" : g1Ok ? "Reachable" : "Not reachable: connect the company VPN" },
  };
}

export { ProviderError };
