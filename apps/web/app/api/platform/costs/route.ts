import { z } from "zod";
import { setCarrierCosts } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ callPerMinPaise: z.number().int().min(0).max(100_000), smsPaise: z.number().int().min(0).max(100_000) });

/** Platform staff: what the carrier charges per started call minute and per text (paise), used to estimate profit. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await setCarrierCosts(getDb(), user, body.parse(await req.json().catch(() => null)))); } catch (err) { return toResponse(err); }
}
