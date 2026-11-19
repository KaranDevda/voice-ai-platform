import { regenerateRecoveryCodes } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Replaces your recovery codes with eight new ones, shown once (password required). */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = z.object({ password: z.string().min(1).max(500) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json({ ok: true, codes: await regenerateRecoveryCodes(getDb(), user, b.data.password) }); } catch (err) { return toResponse(err); }
}
