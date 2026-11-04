import { z } from "zod";
import { adjustCredit } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ orgId: z.string().uuid().optional(), amountPaise: z.number().int(), note: z.string().min(1).max(300), refund: z.boolean().optional() });

/** Platform staff only: a manual correction or refund, with a required note. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await adjustCredit(getDb(), user, body.parse(await req.json().catch(() => null)))); } catch (err) { return toResponse(err); }
}
