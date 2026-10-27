import { findDeviceCall, setRecordingKey } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { requireDevice } from "@/lib/mobile-auth";
import { getDb } from "@/lib/server";
import { MAX_RECORDING_BYTES, RECORDING_TYPES, putRecording, recordingKey } from "@/lib/recording-store";

/**
 * The phone uploads the recording of one of its own calls (raw audio in the body). The call must already have been synced.
 * 200 `attached`, 200 `already_has_one` (nothing changes), 404 when this phone never uploaded that call, 413/415 for bad files.
 */
export async function POST(req: Request, { params }: { params: Promise<{ localId: string }> }) {
  const device = await requireDevice(req);
  if (device instanceof Response) return device;
  const { localId } = await params;
  const mime = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!RECORDING_TYPES[mime]) return Response.json({ error: "unsupported_type", message: "Send audio (mp3, m4a, aac, amr, 3gp, wav, ogg)." }, { status: 415 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_RECORDING_BYTES) return Response.json({ error: "file_too_large" }, { status: 413 });
  try {
    const call = await findDeviceCall(getDb(), device, localId.slice(0, 64));
    if (!call) return Response.json({ error: "call_not_found" }, { status: 404 });
    if (call.hasRecording) return Response.json({ result: "already_has_one" });
    const data = new Uint8Array(await req.arrayBuffer());
    if (!data.length || data.length > MAX_RECORDING_BYTES) return Response.json({ error: data.length ? "file_too_large" : "empty" }, { status: data.length ? 413 : 400 });
    const key = recordingKey(call.orgId, call.id, mime);
    await putRecording(key, data);
    return Response.json({ result: (await setRecordingKey(getDb(), device, call.id, key)) ? "attached" : "already_has_one" });
  } catch (err) {
    return toResponse(err);
  }
}
