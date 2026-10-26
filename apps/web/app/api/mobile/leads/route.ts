import { listLeadOptions } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { requireDevice } from "@/lib/mobile-auth";
import { getDb } from "@/lib/server";

/** The leads this person may call (name, number, Do Not Disturb), for caller names and pre-call checks in the app. */
export async function GET(req: Request) {
  const device = await requireDevice(req);
  if (device instanceof Response) return device;
  try {
    return Response.json({ leads: await listLeadOptions(getDb(), device.actor) });
  } catch (err) {
    return toResponse(err);
  }
}
