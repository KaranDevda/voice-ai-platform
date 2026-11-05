import { z } from "zod";
import { updateWidget } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** { action: "enable" | "disable" | "delete" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  const b = z.object({ action: z.enum(["enable", "disable", "delete"]) }).safeParse(await req.json().catch(() => null));
  if (!id.success || !b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await updateWidget(getDb(), user, id.data, b.data.action)); } catch (err) { return toResponse(err); }
}
