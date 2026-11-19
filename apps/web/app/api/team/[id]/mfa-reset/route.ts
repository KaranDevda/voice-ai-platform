import { adminResetMfa } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** An admin clears a teammate's 2FA (lost phone). Audited. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return (await adminResetMfa(getDb(), user, id.data)) ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 }); } catch (err) { return toResponse(err); }
}
