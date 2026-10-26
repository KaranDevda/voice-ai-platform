import { getCallingWindow } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { requireDevice } from "@/lib/mobile-auth";
import { getDb } from "@/lib/server";

/** The app calls this on start: it confirms the pairing still works and returns the calling window to show. */
export async function GET(req: Request) {
  const device = await requireDevice(req);
  if (device instanceof Response) return device;
  try {
    return Response.json({ deviceId: device.deviceId, calling: await getCallingWindow(getDb(), device.actor) });
  } catch (err) {
    return toResponse(err);
  }
}
