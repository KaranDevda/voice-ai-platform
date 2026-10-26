import { z } from "zod";
import { revokeVoiceProfile } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getElevenLabs, getPocketTts } from "@/lib/providers";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    await revokeVoiceProfile(getDb(), user, id, (voiceId, provider) => (provider === "pocket_tts" ? getPocketTts() : getElevenLabs()).deleteVoice(voiceId));
    return Response.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
