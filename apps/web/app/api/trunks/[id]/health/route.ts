import { getMyTrunk, saveTrunkHealth } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { getTwilio } from "@/lib/providers";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";
import { twilioOnly } from "@/lib/trunks";

/** Runs the diagnostics now: live trunk settings, a reachability test of each of the customer's SIP endpoints, and the last day of calls. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const refused = twilioOnly();
  if (refused) return refused;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const t = await getMyTrunk(getDb(), user, id.data);
    const health = await getTwilio().trunkHealth(t.providerTrunkSid);
    await saveTrunkHealth(getDb(), user, id.data, health);
    return Response.json(health);
  } catch (err) { return toResponse(err); }
}
