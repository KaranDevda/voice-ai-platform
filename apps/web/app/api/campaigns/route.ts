import { z } from "zod";
import { createCampaign, listCampaigns } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  name: z.string().trim().min(1).max(120), language: z.enum(["en", "hi", "en-hi"]).default("en-hi"), voice: z.string().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
  startAt: z.string().datetime().optional(),
  maxConcurrent: z.number().int().default(2), maxAttempts: z.number().int().default(2), retryDelayMin: z.number().int().default(60),
});

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listCampaigns(getDb(), user)); } catch (err) { return toResponse(err); }
}

/** Creates a campaign from everyone with one of the tags. Nobody is called until it is started (or its start time arrives). */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const i = body.parse(await req.json().catch(() => null));
    const tags = i.tags.map((t) => t.toLowerCase());
    return Response.json(await createCampaign(getDb(), user, { ...i, tags, voice: i.voice, startAt: i.startAt ? new Date(i.startAt) : null }), { status: 201 });
  } catch (err) { return toResponse(err); }
}
