import { z } from "zod";
import { deleteAsset } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    return (await deleteAsset(getDb(), user, id)) ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch (err) {
    return toResponse(err);
  }
}
