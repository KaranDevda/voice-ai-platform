import { signVoiceToken } from "@voiceai/auth";
import { studioRoute } from "@/lib/studio-route";

/** A 60-second pass to open one listen-in stream. The voice service still checks the user's permissions for the chosen call. */
export const POST = () =>
  studioRoute({ mutation: true }, async (user) => {
    const key = process.env.VOICE_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
    if (!key) return Response.json({ error: "not_configured" }, { status: 503 });
    const ws = process.env.VOICE_WS_URL?.trim() || "ws://localhost:4001/stream";
    return Response.json({ token: signVoiceToken({ sub: user.id, org: user.orgId }, key, 60), url: ws.replace(/\/stream.*$/, "/listen") });
  });
