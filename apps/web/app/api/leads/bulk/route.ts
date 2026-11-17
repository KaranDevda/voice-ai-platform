import { z } from "zod";
import { bulkUpdateLeads } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: z.enum(["new", "contacted", "interested", "callback_requested", "not_interested", "won", "lost"]).optional(),
  consent: z.enum(["unknown", "granted", "denied", "withdrawn"]).optional(),
  dnd: z.boolean().optional(),
  setTags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  addTags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  removeTags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
});

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  const { ids, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0) return Response.json({ error: "nothing_to_update" }, { status: 400 });
  try {
    const r = await bulkUpdateLeads(getDb(), user, ids, patch);
    return Response.json(r);
  } catch (err) { return toResponse(err); }
}
