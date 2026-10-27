import { applySuggestedStatus } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** The owner confirms the lead status the AI suggested but was not sure enough to apply by itself. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const result = await applySuggestedStatus(getDb(), user, id);
    return result === "not_found" ? Response.json({ error: "not_found" }, { status: 404 }) : Response.json({ result });
  } catch (err) {
    return toResponse(err);
  }
}
