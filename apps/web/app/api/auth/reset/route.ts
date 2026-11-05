import { z } from "zod";
import { resetPassword } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb } from "@/lib/server";
import { json } from "@/lib/auth-routes";
import { verifyToken, type ResetClaims } from "@/lib/session";

/** Sets a new password from a reset link. The link must be valid, fresh and unused (it carries a code of the old password, which changes on use). Does not sign anyone in. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return json({ error: "bad_origin" }, 403);
  const parsed = z.object({ token: z.string().min(20).max(2000), password: z.string().min(1).max(500) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  const claims = await verifyToken<ResetClaims>(parsed.data.token, "reset");
  if (!claims?.fp) return json({ error: "invalid_link", message: "This link is not valid or has expired. Ask for a new one." }, 400);
  try {
    const ok = await resetPassword(getDb(), claims.sub, claims.fp, parsed.data.password, claims.em ?? "");
    return ok ? json({ ok: true }) : json({ error: "invalid_link", message: "This link was already used or has expired. Ask for a new one." }, 400);
  } catch (err) { return toResponse(err); }
}
