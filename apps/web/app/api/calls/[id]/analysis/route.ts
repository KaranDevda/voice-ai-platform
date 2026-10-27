import { requeueAnalysis } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Asks the worker to analyse this call again (it failed, or a fresh answer is wanted). A re-run never changes the lead's status. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const result = await requeueAnalysis(getDb(), user, id);
    return result === "not_found" ? Response.json({ error: "not_found" }, { status: 404 }) : result === "no_transcript" ? Response.json({ error: "no_transcript", message: "This call has no transcript to analyse." }, { status: 409 }) : Response.json({ result });
  } catch (err) {
    return toResponse(err);
  }
}
