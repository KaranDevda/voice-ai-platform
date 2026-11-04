import { z } from "zod";
import { platformAddNumber, platformAssignNumber, platformReleaseNumber } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), e164: z.string().max(20), label: z.string().max(80).optional() }),
  z.object({ action: z.literal("assign"), numberId: z.string().uuid(), orgId: z.string().uuid() }),
  z.object({ action: z.literal("release"), numberId: z.string().uuid() }),
]);

/** Platform staff: add a number to the inventory, give it to an organisation, or take it back. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const d = b.data;
    return Response.json(d.action === "add" ? await platformAddNumber(getDb(), user, d) : d.action === "assign" ? await platformAssignNumber(getDb(), user, d.numberId, d.orgId) : await platformReleaseNumber(getDb(), user, d.numberId));
  } catch (err) { return toResponse(err); }
}
