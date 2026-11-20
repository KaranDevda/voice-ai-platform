import { commitNumberTrunk, setNumberTrunk } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { getTwilio } from "@/lib/providers";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";
import { twilioOnly } from "@/lib/trunks";

/** Routes one of the organisation's Twilio numbers through the trunk (attach) or back to Twilio's own handling (detach). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const refused = twilioOnly();
  if (refused) return refused;
  const id = z.string().uuid().safeParse((await params).id);
  const b = z.object({ numberId: z.string().uuid(), attach: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!id.success || !b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const { number, trunk } = await setNumberTrunk(getDb(), user, b.data.numberId, id.data);
    if (!trunk) return Response.json({ error: "invalid_request" }, { status: 400 });
    if (!b.data.attach && number.trunkId !== id.data) return Response.json({ error: "admin", message: "that number is not on this trunk" }, { status: 409 });
    if (b.data.attach && number.trunkId && number.trunkId !== id.data) return Response.json({ error: "admin", message: "that number is already on another trunk; detach it there first" }, { status: 409 });
    const twilio = getTwilio();
    const phoneSid = await twilio.incomingNumberSid(number.e164);
    if (!phoneSid) return Response.json({ error: "admin", message: "Twilio does not list that number on the account" }, { status: 409 });
    if (b.data.attach) await twilio.attachNumber(trunk.providerTrunkSid, phoneSid); else await twilio.detachNumber(trunk.providerTrunkSid, phoneSid);
    await commitNumberTrunk(getDb(), user, b.data.numberId, b.data.attach ? id.data : null);
    return Response.json({ numberId: b.data.numberId, trunkId: b.data.attach ? id.data : null });
  } catch (err) { return toResponse(err); }
}
