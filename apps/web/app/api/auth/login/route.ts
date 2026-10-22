import { cookies } from "next/headers";
import { z } from "zod";
import { login } from "@voiceai/db";
import { assertSameOrigin, clientMeta, encryptionKey, getDb } from "@/lib/server";
import { json, startSession } from "@/lib/auth-routes";
import { cookieOptions, ENROLL_COOKIE, ENROLL_TTL_S, signToken } from "@/lib/session";

const body = z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().optional() });

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return json({ error: "bad_origin" }, 403);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const result = await login(getDb(), { ...parsed.data, ...(await clientMeta()) }, { encryptionKey: encryptionKey() });
  const jar = await cookies();

  if (result.ok) {
    await startSession(jar, { sub: result.user.id, org: result.user.orgId });
    return json({ ok: true });
  }
  if (result.reason === "mfa_required") return json({ error: "mfa_required" }, 401);
  if (result.reason === "mfa_enrollment_required") {
    jar.set(ENROLL_COOKIE, await signToken({ sub: result.userId, org: result.orgId }, ENROLL_TTL_S, "enroll"), cookieOptions(ENROLL_TTL_S));
    return json({ error: "mfa_enrollment_required" }, 403);
  }
  // Wrong credentials and locked accounts look identical so the response never confirms an account exists.
  return json({ error: "invalid_credentials" }, 401);
}
