import { createHmac, timingSafeEqual } from "node:crypto";

/** Claims a signed-in user hands the voice service so it never needs the web session cookie. */
export interface VoiceTokenClaims {
  sub: string;
  org: string;
  /** Optional: voice reference the session is allowed to use (e.g. "pocket:alba"). */
  voice?: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (key: string, body: string) => createHmac("sha256", key).update(`voice-stream:${body}`).digest();

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
    return { sub: c.sub, org: c.org, voice: c.voice };
  } catch {
    return null;
  }
}
