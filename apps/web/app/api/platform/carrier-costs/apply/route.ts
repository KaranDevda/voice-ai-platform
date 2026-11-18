import { z } from "zod";
import { applyMargins } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ orgId: z.string().uuid() });

/** Platform staff: set an organisation's country prices to carrier cost plus margin, for every country that has a cost. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await applyMargins(getDb(), user, body.parse(await req.json().catch(() => null)).orgId)); } catch (err) { return toResponse(err); }
}
