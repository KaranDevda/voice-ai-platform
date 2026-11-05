import { signVoiceToken } from "@voiceai/auth";
import { findWidget } from "@voiceai/db";
import { RateLimiter } from "@voiceai/shared";
import { getDb } from "@/lib/server";

/**
 * Called by the widget script on a customer's website (no sign-in). A browser always states the page's site in the Origin header and a
 * page cannot change it, so the widget's own list of sites decides who may start a call; the answer carries CORS headers for that site only.
 * A 60-second voice pass comes back. Limits: 6 calls a minute from one address, 60 a minute for one widget.
 */
const perAddress = new RateLimiter(6, 60_000), perWidget = new RateLimiter(60, 60_000);
const cors = (origin: string | null): Record<string, string> => (origin ? { "access-control-allow-origin": origin, vary: "origin", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } : { vary: "origin" });
const json = (b: unknown, status: number, origin: string | null) => Response.json(b, { status, headers: { ...cors(origin), "cache-control": "no-store" } });

export async function OPTIONS(req: Request) {
  // The key is not in a preflight, so it cannot be checked here; the real request is.
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.VOICE_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  const b = (await req.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof b?.key === "string" ? b.key : "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!perAddress.take(`${ip}`).ok) return json({ error: "rate_limited" }, 429, null);
  const w = await findWidget(getDb(), key).catch(() => null);
  // The same answer for an unknown key, a switched-off widget and a site not on the list, so keys cannot be probed.
  if (!w || !w.active || !origin || !w.origins.includes(origin)) return json({ error: "not_allowed" }, 403, null);
  if (!perWidget.take(w.id).ok) return json({ error: "rate_limited" }, 429, origin);
  if (!secret) return json({ error: "not_configured" }, 503, origin);
  const url = process.env.VOICE_WS_URL?.trim() || "ws://localhost:4001/stream";
  return json({ token: signVoiceToken({ sub: w.createdBy, org: w.orgId, voice: w.voice ?? undefined }, secret, 60), url, language: w.language, voice: w.voice ?? "pocket:alba" }, 200, origin);
}
