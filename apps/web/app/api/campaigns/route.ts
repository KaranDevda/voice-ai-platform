import { z } from "zod";
import { createCampaign, listCampaigns } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  name: z.string().trim().min(1).max(120), language: z.enum(["en", "hi", "en-hi"]).default("en-hi"), voice: z.string().max(100).optional(), callerId: z.string().regex(/^\+[1-9]\d{4,14}$/).nullable().optional(),
  aiModel: z.enum(["inherit", "default", "openrouter"]).default("inherit"), openrouterModel: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i).max(100).optional(), agentProfileId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
  startAt: z.string().datetime().optional(),
  autoSchedule: z.boolean().default(false),
  detectMachines: z.boolean().default(true), mode: z.enum(["ai", "audio"]).default("ai"), openingVariants: z.array(z.string().trim().max(300)).max(3).default([]),
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
    if (i.aiModel === "openrouter" && !i.openrouterModel) return Response.json({ error: "openrouter_model_required", message: "Enter an OpenRouter model ID, such as openai/gpt-4o-mini." }, { status: 400 });
    const tags = i.tags.map((t) => t.toLowerCase());
    return Response.json(await createCampaign(getDb(), user, { ...i, tags, voice: i.voice, startAt: i.startAt ? new Date(i.startAt) : null }), { status: 201 });
  } catch (err) { return toResponse(err); }
}
