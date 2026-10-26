import { syncDeviceCalls } from "@voiceai/db";
import { splitSyncBatch, syncBatchSchema, type SyncOutcome } from "@voiceai/shared";
import { toResponse } from "@/lib/api-errors";
import { requireDevice } from "@/lib/mobile-auth";
import { getDb } from "@/lib/server";

/** Uploads calls from the phone's work SIM. Safe to repeat; every call gets an answer so the app can empty its queue. */
export async function POST(req: Request) {
  const device = await requireDevice(req);
  if (device instanceof Response) return device;
  try {
    const { calls } = syncBatchSchema.parse(await req.json().catch(() => null));
    const { valid, invalid } = splitSyncBatch(calls);
    const saved = valid.length ? await syncDeviceCalls(getDb(), device, valid.map((v) => v.call)) : [];
    const results: SyncOutcome[] = [];
    valid.forEach((v, i) => { results[v.at] = saved[i]!; });
    invalid.forEach((v) => { results[v.at] = v.outcome; });
    return Response.json({ results });
  } catch (err) {
    return toResponse(err);
  }
}
