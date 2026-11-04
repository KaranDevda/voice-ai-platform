import { z } from "zod";
import { enrollTags, updateSequence } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.union([
  z.object({ action: z.enum(["pause", "resume", "stop", "archive"]) }),
  z.object({ enrollTags: z.array(z.string().trim().min(1).max(30)).min(1).max(10) }),
]);

/** { action: "pause" | "resume" | "stop" | "archive" } or { enrollTags: ["diwali"] } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  const b = body.safeParse(await req.json().catch(() => null));
  if (!id.success || !b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    return Response.json("action" in b.data ? await updateSequence(getDb(), user, id.data, b.data.action) : await enrollTags(getDb(), user, id.data, b.data.enrollTags.map((t) => t.toLowerCase())));
  } catch (err) { return toResponse(err); }
}
