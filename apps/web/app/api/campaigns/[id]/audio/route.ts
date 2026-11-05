import { z } from "zod";
import { MAX_AUDIO_BYTES, saveCampaignAudio } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** The recording an audio campaign plays: the file itself as the request body (MP3 or WAV, at most 5 MB), its name in the X-File-Name header. What the file really is, is decided from its own bytes. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 4096) return Response.json({ error: "campaign", message: "the recording must be 5 MB or smaller" }, { status: 409 });
  try {
    const data = new Uint8Array(await req.arrayBuffer());
    return Response.json(await saveCampaignAudio(getDb(), user, id.data, { name: decodeURIComponent(req.headers.get("x-file-name") ?? "recording"), data }));
  } catch (err) { return toResponse(err); }
}
