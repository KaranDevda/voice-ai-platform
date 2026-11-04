import { z } from "zod";
import { reviewKyc } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  const b = z.object({ approve: z.boolean(), note: z.string().max(300).optional() }).safeParse(await req.json().catch(() => null));
  if (!id.success || !b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await reviewKyc(getDb(), user, id.data, b.data.approve, b.data.note)); } catch (err) { return toResponse(err); }
}
