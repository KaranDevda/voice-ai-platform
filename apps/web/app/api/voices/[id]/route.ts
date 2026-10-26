import { z } from "zod";
import { updateVoiceProfile } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Corrects a cloned voice's name or gender. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const v = await updateVoiceProfile(getDb(), user, id, await req.json().catch(() => null));
    return Response.json({ id: v.id, label: v.label, gender: v.gender });
  } catch (err) {
    return toResponse(err);
  }
}
