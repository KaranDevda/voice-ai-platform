import { checkOutboundCall, checkOutboundNumber } from "@voiceai/db";
import { CALL_BLOCK_MESSAGES, checkCallSchema } from "@voiceai/shared";
import { toResponse } from "@/lib/api-errors";
import { requireDevice } from "@/lib/mobile-auth";
import { getDb } from "@/lib/server";

/** Before dialling: Do Not Disturb, consent and calling hours (India time). A blocked attempt is audited. */
export async function POST(req: Request) {
  const device = await requireDevice(req);
  if (device instanceof Response) return device;
  try {
    const { leadId, number } = checkCallSchema.parse(await req.json().catch(() => null));
    const result = leadId ? await checkOutboundCall(getDb(), device.actor, leadId) : await checkOutboundNumber(getDb(), device.actor, number!);
    if (result.allowed) return Response.json({ allowed: true });
    const message = result.reason === "invalid_number" ? "That is not a valid phone number." : CALL_BLOCK_MESSAGES[result.reason];
    return Response.json({ allowed: false, reason: result.reason, message });
  } catch (err) {
    return toResponse(err);
  }
}
