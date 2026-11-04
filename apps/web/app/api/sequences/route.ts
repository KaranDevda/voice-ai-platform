import { z } from "zod";
import { createSequence, listSequences } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ name: z.string().trim().min(1).max(120), steps: z.array(z.object({ delayMin: z.number().int().min(0).max(43200), body: z.string().min(1).max(1000), dltTemplateId: z.string().max(30).optional() })).min(1).max(10) });

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listSequences(getDb(), user)); } catch (err) { return toResponse(err); }
}

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await createSequence(getDb(), user, body.parse(await req.json().catch(() => null))), { status: 201 }); } catch (err) { return toResponse(err); }
}
