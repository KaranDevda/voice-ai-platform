import { z } from "zod";
import { updateExtraLanguage, deleteExtraLanguage } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const patch = z.object({ enabled: z.boolean().optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const code = z.string().min(2).max(5).safeParse((await params).code);
  if (!code.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  try {
    const extra = await updateExtraLanguage(getDb(), user, code.data, parsed.data.enabled ?? true);
    return Response.json(extra);
  } catch (err) { return toResponse(err); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const code = z.string().min(2).max(5).safeParse((await params).code);
  if (!code.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    await deleteExtraLanguage(getDb(), user, code.data);
    return Response.json({ ok: true });
  } catch (err) { return toResponse(err); }
}