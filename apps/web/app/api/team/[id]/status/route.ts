import { z } from "zod";
import { setMemberStatus } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** An admin switches a teammate off (cannot sign in; open sessions stop working) or back on. Audited. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  const b = z.object({ status: z.enum(["active", "disabled"]) }).safeParse(await req.json().catch(() => null));
  if (!id.success || !b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return (await setMemberStatus(getDb(), user, id.data, b.data.status)) ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 }); } catch (err) { return toResponse(err); }
}
