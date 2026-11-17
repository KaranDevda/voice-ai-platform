import { z } from "zod";
import { deleteTranslationOverride } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = z.string().min(1).max(400).safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const [key, language] = id.data.split("|");
  if (!key || !language) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    await deleteTranslationOverride(getDb(), user, key, language);
    return Response.json({ ok: true });
  } catch (err) { return toResponse(err); }
}