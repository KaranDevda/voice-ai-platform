import { z } from "zod";
import { assertAuthorized } from "@voiceai/auth";
import { ProviderError, smtpFromEnv, sendEmail, smtpSummary } from "@voiceai/providers";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, requireUser } from "@/lib/server";

/** Platform staff: whether e-mail (SMTP) is set up. The password is never returned. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { assertAuthorized(user, "platform.admin"); return Response.json(smtpSummary(smtpFromEnv())); } catch (err) { return toResponse(err); }
}

/** Platform staff: sends a test message to the address given, to check the SMTP settings. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = z.object({ to: z.string().trim().max(200) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    assertAuthorized(user, "platform.admin");
    const cfg = smtpFromEnv();
    if (!cfg) return Response.json({ error: "not_configured", message: "Set SMTP_HOST and SMTP_FROM (and SMTP_PORT, SMTP_USER, SMTP_PASS) on the server first." }, { status: 409 });
    await sendEmail(cfg, { to: b.data.to, subject: "Bizfy Voice AI: test message", text: "This is a test message. Your e-mail settings work." });
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof ProviderError) return Response.json({ error: "email", message: err.message }, { status: 502 });
    return toResponse(err);
  }
}
