import { createHmac, timingSafeEqual } from "node:crypto";

/** Claims a signed-in user hands the voice service so it never needs the web session cookie. */
export interface VoiceTokenClaims {
  sub: string;
  org: string;
  /** Optional: voice reference the session is allowed to use (e.g. "pocket:alba"). */
  voice?: string;
  /** Optional campaign-specific model override, issued only by the trusted campaign worker. */
  aiModel?: "default" | "openrouter";
  /** OpenRouter model ID for a campaign override; never an API key. */
  openrouterModel?: string;
  /** Organisation-owned campaign agent profile, fetched by the voice service under this organisation. */
  agentProfileId?: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (key: string, body: string) => createHmac("sha256", key).update(`voice-stream:${body}`).digest();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Short-lived, signed token for one voice stream. The web app issues it; the voice service verifies it. */
export function signVoiceToken(claims: VoiceTokenClaims, key: string, ttlSeconds = 60, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + ttlSeconds }));
  return `${body}.${b64(mac(key, body))}`;
}

export function verifyVoiceToken(token: string, key: string, now = Date.now()): VoiceTokenClaims | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(key, body), got = Buffer.from(sig, "base64url");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as VoiceTokenClaims & { exp?: number };
    if (typeof c.exp !== "number" || c.exp * 1000 < now || !c.sub || !c.org) return null;
    if (c.aiModel !== undefined && c.aiModel !== "default" && c.aiModel !== "openrouter") return null;
    if (c.openrouterModel !== undefined && (typeof c.openrouterModel !== "string" || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(c.openrouterModel) || c.openrouterModel.length > 100)) return null;
    if (c.aiModel !== "openrouter" && c.openrouterModel !== undefined) return null;
    if (c.agentProfileId !== undefined && (typeof c.agentProfileId !== "string" || !UUID.test(c.agentProfileId))) return null;
    return {
      sub: c.sub,
      org: c.org,
      ...(c.voice ? { voice: c.voice } : {}),
      ...(c.aiModel ? { aiModel: c.aiModel } : {}),
      ...(c.openrouterModel ? { openrouterModel: c.openrouterModel } : {}),
      ...(c.agentProfileId ? { agentProfileId: c.agentProfileId } : {}),
    };
  } catch {
    return null;
  }
}
