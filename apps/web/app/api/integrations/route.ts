import { z } from "zod";
import { createIntegration, listIntegrations } from "@voiceai/db";
import { assertPublicUrl } from "@voiceai/providers";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ name: z.string().trim().min(1).max(80), url: z.string().url().max(500), events: z.array(z.string().max(40)).max(10).optional() });

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listIntegrations(getDb(), user)); } catch (err) { return toResponse(err); }
}

/** Adds a CRM address. It must be https and point at the public internet. The signing secret is in the answer, once. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const b = body.parse(await req.json().catch(() => null));
    await assertPublicUrl(b.url);
    return Response.json(await createIntegration(getDb(), user, b), { status: 201 });
  } catch (err) { return toResponse(err); }
}
