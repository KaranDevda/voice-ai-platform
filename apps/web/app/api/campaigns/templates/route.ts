import { z } from "zod";
import { listCampaignTemplates, saveCampaignTemplate } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  name: z.string().trim().min(1).max(120),
  language: z.enum(["en", "hi", "en-hi"]),
  tags: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
  callerId: z.string().regex(/^\+[1-9]\d{4,14}$/).nullable().optional(),
  aiModel: z.enum(["inherit", "default", "openrouter"]).default("inherit"), openrouterModel: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i).max(100).optional(), agentProfileId: z.string().uuid().nullable().optional(),
  autoSchedule: z.boolean().default(false),
  maxConcurrent: z.number().int().min(1).max(20), maxAttempts: z.number().int().min(1).max(5), retryDelayMin: z.number().int().min(5).max(1440),
  detectMachines: z.boolean(), mode: z.enum(["ai", "audio"]), openingVariants: z.array(z.string().trim().max(300)).max(3),
});

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listCampaignTemplates(getDb(), user)); } catch (err) { return toResponse(err); }
}

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  if (parsed.data.aiModel === "openrouter" && !parsed.data.openrouterModel) return Response.json({ error: "openrouter_model_required", message: "Enter an OpenRouter model ID, such as openai/gpt-4o-mini." }, { status: 400 });
  try { return Response.json(await saveCampaignTemplate(getDb(), user, parsed.data), { status: 201 }); } catch (err) { return toResponse(err); }
}
