import { z } from "zod";
import { findUserForReset } from "@voiceai/db";
import { sendEmail, smtpFromEnv } from "@voiceai/providers";
import { assertSameOrigin, getDb } from "@/lib/server";
import { json } from "@/lib/auth-routes";
import { RESET_TTL_S, signToken } from "@/lib/session";

/**
 * "Forgot password". The answer is the same whether or not the address belongs to anyone (and comes back at once, before any e-mail is sent), so this cannot be
 * used to find out who has an account. The link is signed, lasts 30 minutes and works once. Needs e-mail (SMTP_*) and APP_URL on the server.
 */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return json({ error: "bad_origin" }, 403);
  const parsed = z.object({ email: z.string().email().max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  const email = parsed.data.email;
  void (async () => {
    try {
      const smtp = smtpFromEnv();
      // The link's address comes from the server's own setting. The request's Host header is not trusted in production: it could be forged to point the link elsewhere.
      const base = process.env.APP_URL?.trim() || (process.env.NODE_ENV === "production" ? "" : new URL(req.url).origin);
      if (!smtp || !base) return void console.warn("password reset requested but e-mail (SMTP_*) or APP_URL is not set: nothing was sent");
      const user = await findUserForReset(getDb(), email);
      if (!user) return;
      const token = await signToken({ sub: user.userId, org: user.orgId, fp: user.fingerprint, em: email.trim().toLowerCase() }, RESET_TTL_S, "reset");
      await sendEmail(smtp, { to: email.trim().toLowerCase(), subject: "Reset your password", text: `Hello,\n\nSomeone asked to reset the password for this e-mail address. To choose a new one, open this link within 30 minutes:\n\n${base.replace(/\/$/, "")}/reset-password?token=${token}\n\nThe link works once. If you did not ask for this, ignore this message: your password has not changed.` });
    } catch (e) { console.error("password reset e-mail failed:", e instanceof Error ? e.message : e); }
  })();
  return json({ ok: true });
}
