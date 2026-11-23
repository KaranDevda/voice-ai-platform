import { z } from "zod";
import { ASSIGNABLE_ROLES, setMemberRole } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** An admin gives a teammate a different role. Audited as user.role_change. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  const b = z.object({ role: z.enum(ASSIGNABLE_ROLES) }).safeParse(await req.json().catch(() => null));
  if (!id.success || !b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return (await setMemberRole(getDb(), user, id.data, b.data.role)) ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 }); } catch (err) { return toResponse(err); }
}
