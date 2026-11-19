import { z } from "zod";
import { setAppErrorResolved } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ resolved: z.boolean() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const ok = await setAppErrorResolved(getDb(), user, id.data, parsed.data.resolved);
    return ok ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch (err) { return toResponse(err); }
}
