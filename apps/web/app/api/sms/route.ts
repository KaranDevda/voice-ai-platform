import { z } from "zod";
import { listSms, queueSmsToLead, queueSmsToTags } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ body: z.string().min(1).max(1000), dltTemplateId: z.string().max(30).optional(), tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(), leadId: z.string().uuid().optional() })
  .refine((v) => !!v.tags?.length !== !!v.leadId, { message: "send to a lead or to tags, not both" });

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listSms(getDb(), user)); } catch (err) { return toResponse(err); }
}

/** Queues a text to one lead (leadId) or to everyone with the tags. The worker sends it inside the calling hours. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const i = body.parse(await req.json().catch(() => null));
    const r = i.leadId ? await queueSmsToLead(getDb(), user, { leadId: i.leadId, body: i.body, dltTemplateId: i.dltTemplateId }) : await queueSmsToTags(getDb(), user, { tags: i.tags!.map((t) => t.toLowerCase()), body: i.body, dltTemplateId: i.dltTemplateId });
    return Response.json(r, { status: 201 });
  } catch (err) { return toResponse(err); }
}
