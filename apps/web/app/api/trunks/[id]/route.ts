import { deleteTrunkRecord, getMyTrunk } from "@voiceai/db";
import { ProviderError } from "@voiceai/providers";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { getTwilio } from "@/lib/providers";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";
import { twilioOnly } from "@/lib/trunks";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const refused = twilioOnly();
  if (refused) return refused;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const t = await getMyTrunk(getDb(), user, id.data);
    // Gone at Twilio already (404) is fine: the record should go too.
    await getTwilio().deleteTrunk(t.providerTrunkSid).catch((e) => { if (!(e instanceof ProviderError && e.status === 404)) throw e; });
    await deleteTrunkRecord(getDb(), user, id.data);
    return Response.json({ id: id.data });
  } catch (err) { return toResponse(err); }
}
