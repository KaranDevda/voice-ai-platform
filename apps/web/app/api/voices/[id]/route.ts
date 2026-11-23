import { z } from "zod";
import { deleteVoiceProfile, updateVoiceProfile } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getElevenLabs, getPocketTts } from "@/lib/providers";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Deletes a cloned voice for good (revoking it first if it is still active). The consent record is kept. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    await deleteVoiceProfile(getDb(), user, id, (voiceId, provider) => (provider === "pocket_tts" ? getPocketTts() : getElevenLabs()).deleteVoice(voiceId));
    return Response.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}

/** Corrects a cloned voice's name or gender. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const v = await updateVoiceProfile(getDb(), user, id, await req.json().catch(() => null));
    return Response.json({ id: v.id, label: v.label, gender: v.gender, speed: v.speed, pitch: v.pitch });
  } catch (err) {
    return toResponse(err);
  }
}
