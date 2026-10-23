import { z } from "zod";
import { getAssetAudio } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const a = await getAssetAudio(getDb(), user, id);
    if (!a) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(new Uint8Array(a.audio) as unknown as BodyInit, { headers: { "content-type": a.mime, "cache-control": "private, no-store", "accept-ranges": "none" } });
  } catch (err) {
    return toResponse(err);
  }
}
