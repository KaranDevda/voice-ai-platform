import { z } from "zod";
import { getVoiceSample } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

/** Plays back the recording a voice was cloned from. Only people who manage voices can hear it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const row = await getVoiceSample(getDb(), user, id);
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(row.audio as unknown as BodyInit, { headers: { "content-type": row.mime, "cache-control": "private, no-store" } });
  } catch (err) {
    return toResponse(err);
  }
}
