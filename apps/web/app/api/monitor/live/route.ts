import { signVoiceToken } from "@voiceai/auth";
import { studioRoute } from "@/lib/studio-route";

/** The calls happening right now that this user may listen in on, asked of the voice service. */
export const GET = () =>
  studioRoute({}, async (user) => {
    const key = process.env.VOICE_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
    if (!key) return Response.json({ error: "not_configured" }, { status: 503 });
    const ws = process.env.VOICE_WS_URL?.trim() || "ws://localhost:4001/stream";
    const base = ws.replace(/^ws/, "http").replace(/\/stream.*$/, "");
    const token = signVoiceToken({ sub: user.id, org: user.orgId }, key, 30);
    try {
      const r = await fetch(`${base}/live-calls?token=${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (!r.ok) return Response.json({ calls: [], canSpeak: false });
      return Response.json(await r.json());
    } catch {
      return Response.json({ calls: [], canSpeak: false, voiceServiceDown: true });
    }
  });
