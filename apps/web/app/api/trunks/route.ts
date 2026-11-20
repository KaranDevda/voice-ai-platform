import { randomBytes } from "node:crypto";
import { assertTrunkRoom, checkSipUrl, checkTrunkName, listMyTrunks, recordTrunk } from "@voiceai/db";
import { ProviderError } from "@voiceai/providers";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { isTwilioConfigured, getTwilio } from "@/lib/providers";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";
import { twilioOnly } from "@/lib/trunks";

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const body = z.object({
  name: z.string().max(80),
  /** Where Twilio sends calls that arrive on your numbers: your carrier or PBX. */
  originationUrl: z.string().max(255),
  /** Outbound: the public IP address of your PBX (one of these two is needed to send calls). */
  allowIp: z.string().regex(IPV4).optional(),
  credential: z.object({ username: z.string().regex(/^[A-Za-z0-9._-]{3,32}$/), password: z.string().min(12).max(64).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/) }).optional(),
});

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json({ twilioConfigured: isTwilioConfigured(), ...(await listMyTrunks(getDb(), user)) }); } catch (err) { return toResponse(err); }
}

/** Creates a SIP trunk at Twilio for the organisation's own carrier (BYOC) and keeps a record. Undone at Twilio if anything fails halfway. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const refused = twilioOnly();
  if (refused) return refused;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  const i = parsed.data;
  let trunkSid = "";
  try {
    const name = checkTrunkName(i.name), sipUrl = checkSipUrl(i.originationUrl);
    await assertTrunkRoom(getDb(), user);
    const twilio = getTwilio();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "trunk";
    const trunk = await twilio.createTrunk({ name: `${name} (${user.orgId.slice(0, 8)})`, domainName: `${slug}-${randomBytes(4).toString("hex")}.pstn.twilio.com` });
    trunkSid = trunk.sid;
    await twilio.addOriginationUrl(trunk.sid, { name, sipUrl });
    if (i.allowIp) await twilio.allowIp(trunk.sid, { name, ip: i.allowIp, cidrPrefix: 32 });
    if (i.credential) await twilio.addCredential(trunk.sid, { name, ...i.credential });
    const row = await recordTrunk(getDb(), user, { name, providerTrunkSid: trunk.sid, terminationDomain: trunk.domainName, originationUrls: [sipUrl] });
    return Response.json(row, { status: 201 });
  } catch (err) {
    if (trunkSid) await getTwilio().deleteTrunk(trunkSid).catch((e) => console.error("could not undo Twilio trunk", trunkSid, e instanceof Error ? e.message : e));
    if (err instanceof ProviderError && err.status < 500) return Response.json({ error: "provider_rejected", message: err.message }, { status: 409 });
    return toResponse(err);
  }
}
