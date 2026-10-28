import { getRecordingForPlay } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { demoWav } from "@/lib/demo-audio";
import { getDb, requireUser } from "@/lib/server";
import { getRecording, recordingLink } from "@/lib/recording-store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });

  try {
    // Authorises against the call's team/owner and writes the audit row before any audio is released.
    const rec = await getRecordingForPlay(getDb(), user, id);
    if (!rec) return Response.json({ error: "not_found" }, { status: 404 });
    // Recordings uploaded by phones: a 5-minute signed link when they are in S3, the bytes themselves when kept on this machine.
    if (rec.key.startsWith("rec/")) {
      const link = await recordingLink(rec.key);
      if (link) return new Response(null, { status: 302, headers: { location: link, "cache-control": "private, no-store" } });
      const stored = await getRecording(rec.key);
      return stored ? new Response(stored.data as unknown as BodyInit, { headers: { "content-type": stored.mime, "cache-control": "private, no-store" } }) : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (!rec.key.startsWith("demo/")) return Response.json({ error: "storage_not_configured" }, { status: 501 });
    return new Response(demoWav(rec.durationS) as unknown as BodyInit, { headers: { "content-type": "audio/wav", "cache-control": "private, no-store" } });
  } catch (err) {
    return toResponse(err);
  }
}
