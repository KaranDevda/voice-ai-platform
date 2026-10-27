import { forgetDevice, getCallingWindow } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { requireDevice } from "@/lib/mobile-auth";
import { deleteRecording } from "@/lib/recording-store";
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

/**
 * "Stop sharing and delete what this phone uploaded". Deletes the phone's calls, recordings, the leads only it created, and the phone's
 * own record (so its token stops working). The person asks for it on their own phone, so it needs no other approval.
 */
export async function DELETE(req: Request) {
  const device = await requireDevice(req);
  if (device instanceof Response) return device;
  try {
    const { recordingKeys, ...counts } = await forgetDevice(getDb(), device);
    await Promise.all(recordingKeys.map(deleteRecording));
    return Response.json({ deleted: { ...counts, recordings: recordingKeys.length } });
  } catch (err) {
    return toResponse(err);
  }
}
