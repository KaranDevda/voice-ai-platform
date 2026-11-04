import { z } from "zod";
import { listSmsTemplates, saveSmsTemplate } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ name: z.string().trim().min(1).max(80), body: z.string().min(1).max(1000), dltTemplateId: z.string().max(30).optional() });

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listSmsTemplates(getDb(), user)); } catch (err) { return toResponse(err); }
}

/** Saves a template (or updates the one with the same name). */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await saveSmsTemplate(getDb(), user, body.parse(await req.json().catch(() => null))), { status: 201 }); } catch (err) { return toResponse(err); }
}
