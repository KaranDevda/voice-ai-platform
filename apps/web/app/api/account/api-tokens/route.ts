import { z } from "zod";
import { createApiToken, listApiTokens } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getAuthUser, getDb } from "@/lib/server";

const body = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: z.array(z.string().min(1).max(80)).min(1).max(60),
  expiresInDays: z.number().int().min(1).max(365),
});

/** API credentials can only be administered from the signed-in account session. */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user || req.headers.has("authorization")) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try { return Response.json(await listApiTokens(getDb(), user)); } catch (err) { return toResponse(err); }
}

export async function POST(req: Request) {
  if (!(await assertSameOrigin()) || req.headers.has("authorization")) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  try { return Response.json(await createApiToken(getDb(), user, parsed.data), { status: 201 }); } catch (err) { return toResponse(err); }
}
