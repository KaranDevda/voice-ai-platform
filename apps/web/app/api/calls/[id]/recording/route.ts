import { getRecordingForPlay } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { demoWav } from "@/lib/demo-audio";
import { getDb, requireUser } from "@/lib/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });

  try {
    // Authorises against the call's team/owner and writes the audit row before any audio is released.
    const rec = await getRecordingForPlay(getDb(), user, id);
    if (!rec) return Response.json({ error: "not_found" }, { status: 404 });
    // Real recordings will be served from S3 through 5-minute signed URLs (SOP); only demo keys work until then.
    if (!rec.key.startsWith("demo/")) return Response.json({ error: "storage_not_configured" }, { status: 501 });
    return new Response(demoWav(rec.durationS) as unknown as BodyInit, { headers: { "content-type": "audio/wav", "cache-control": "private, no-store" } });
  } catch (err) {
    return toResponse(err);
  }
}
