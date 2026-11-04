import { cookies } from "next/headers";
import { z } from "zod";
import { assertAuthorized } from "@voiceai/auth";
import { auditImpersonation, loadAuthUser } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";
import { cookieOptions, IMPERSONATION_TTL_S, SESSION_COOKIE, signToken } from "@/lib/session";

const body = z.object({ userId: z.string().uuid(), orgId: z.string().uuid() });

/**
 * Platform staff act as another person (to see what they see and help them). Rules: staff only; never as another member of staff;
 * never as someone suspended; always written to the audit log of that person's organisation; lasts an hour; a banner shows it.
 */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const admin = await requireUser();
  if (admin instanceof Response) return admin;
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    assertAuthorized(admin, "platform.admin");
    if (b.data.userId === admin.id) return Response.json({ error: "admin", message: "That is you." }, { status: 409 });
    const target = await loadAuthUser(getDb(), b.data.orgId, b.data.userId);
    if (!target) return Response.json({ error: "admin", message: "That person is not active, or does not exist." }, { status: 409 });
    if (target.permissions.includes("platform.admin")) return Response.json({ error: "admin", message: "You cannot act as another member of platform staff." }, { status: 403 });
    await auditImpersonation(getDb(), admin, target, "admin.impersonate_start");
    (await cookies()).set(SESSION_COOKIE, await signToken({ sub: target.id, org: target.orgId, impBy: admin.id, impOrg: admin.orgId }, IMPERSONATION_TTL_S, "session"), cookieOptions(IMPERSONATION_TTL_S));
    return Response.json({ ok: true });
  } catch (err) { return toResponse(err); }
}
