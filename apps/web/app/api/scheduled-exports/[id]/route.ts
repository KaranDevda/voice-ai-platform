import { z } from "zod";
import { deleteCronJob, updateCronJob } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const patch = z.object({
  active: z.boolean().optional(),
  cron: z.string().regex(/^(@\w+|(\*|([0-9\-\/]+))\s+){4}(\*|([0-9\-\/]+))$/).optional(),
  email: z.string().email().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.some((p) => p.startsWith("leads.export."))) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  try {
    const job = await updateCronJob(getDb(), user, id.data, parsed.data);
    return Response.json(job);
  } catch (err) { return toResponse(err); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.some((p) => p.startsWith("leads.export."))) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    await deleteCronJob(getDb(), user, id.data);
    return Response.json({ ok: true });
  } catch (err) { return toResponse(err); }
}