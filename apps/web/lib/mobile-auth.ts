import "server-only";
import { authenticateDevice, type DeviceSession } from "@voiceai/db";
import { getDb } from "./server";

/** The phone's device session, or a 401. The token travels as `Authorization: Bearer vd_...`; it is never put in a URL. */
export async function requireDevice(req: Request): Promise<DeviceSession | Response> {
  const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  const session = token ? await authenticateDevice(getDb(), token) : null;
  // The same answer for "no token", "unknown token" and "revoked": the app clears its pairing on any 401.
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  // 120 requests a minute per phone is far more than the app needs (it syncs about once a minute); the app treats a 429 as "try later".
  if (tooManyAttempts(`dev:${session.deviceId}`, 120, 60_000)) return Response.json({ error: "too_many_requests" }, { status: 429, headers: { "retry-after": "30" } });
  return session;
}

const attempts = new Map<string, number[]>();
/** At most `max` tries per key in `windowMs`, so a pairing code cannot be guessed by brute force. In memory: per server instance. */
export function tooManyAttempts(key: string, max = 10, windowMs = 10 * 60_000, now = Date.now()): boolean {
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (!v.some((t) => now - t < windowMs)) attempts.delete(k);
  return recent.length > max;
}
