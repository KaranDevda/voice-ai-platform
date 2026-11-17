import { z } from "zod";
import { writeAppErrorOrg } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  route: z.string().min(1).max(256),
  method: z.string().max(10).optional().nullable(),
  errorMessage: z.string().min(1).max(2000),
  errorStack: z.string().max(10000).optional().nullable(),
  requestBody: z.unknown().optional().nullable(),
  requestHeaders: z.unknown().optional().nullable(),
  userAgent: z.string().max(512).optional().nullable(),
  ip: z.string().max(45).optional().nullable(),
});

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  const { route, method, errorMessage, errorStack, requestBody, requestHeaders, userAgent, ip } = parsed.data;
  try {
    await writeAppErrorOrg(getDb(), { orgId: user.orgId, teamId: user.teamIds[0] ?? null, userId: user.id, route, method, errorMessage, errorStack, requestBody, requestHeaders, userAgent, ip });
    return Response.json({ ok: true });
  } catch (err) { return toResponse(err); }
}