import { checkOutboundCall, checkOutboundNumber } from "@voiceai/db";
import { CALL_BLOCK_MESSAGES, checkCallSchema } from "@voiceai/shared";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Before dialling from the web dialer: Do Not Disturb, consent and calling hours. A blocked attempt is audited. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const { leadId, number } = checkCallSchema.parse(await req.json().catch(() => null));
    const result = leadId ? await checkOutboundCall(getDb(), user, leadId) : await checkOutboundNumber(getDb(), user, number!);
    if (result.allowed) return Response.json({ allowed: true });
    return Response.json({ allowed: false, reason: result.reason, message: result.reason === "invalid_number" ? "That is not a valid phone number." : CALL_BLOCK_MESSAGES[result.reason] });
  } catch (err) {
    return toResponse(err);
  }
}
