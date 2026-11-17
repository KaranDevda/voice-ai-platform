import { z } from "zod";
import { revokeApiToken } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getAuthUser, getDb } from "@/lib/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin()) || req.headers.has("authorization")) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    if (!(await revokeApiToken(getDb(), user, id))) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) { return toResponse(err); }
}
