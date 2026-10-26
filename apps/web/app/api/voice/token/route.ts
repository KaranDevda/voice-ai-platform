import { signVoiceToken } from "@voiceai/auth";
import { studioRoute } from "@/lib/studio-route";

/** A 60-second pass that lets this signed-in user open one stream to the voice service. */
export const POST = () =>
  studioRoute({ mutation: true }, async (user) => {
    const key = process.env.VOICE_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
    if (!key) return Response.json({ error: "not_configured", message: "Set SESSION_SECRET in apps/web/.env.local" }, { status: 503 });
    const url = process.env.VOICE_WS_URL?.trim() || "ws://localhost:4001/stream";
    return Response.json({ token: signVoiceToken({ sub: user.id, org: user.orgId }, key, 60), url });
  });
