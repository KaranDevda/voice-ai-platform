import { z } from "zod";
import { deleteCampaignTemplate } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await deleteCampaignTemplate(getDb(), user, id.data)); } catch (err) { return toResponse(err); }
}
