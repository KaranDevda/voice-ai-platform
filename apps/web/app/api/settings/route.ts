import { confirmOwnPassword, updateOrgSettings } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/**
 * Organisation-wide settings. Saving needs the admin's own password again ("confirmPassword"), checked before anything
 * changes, so a session left open on a shared screen cannot change how every call behaves.
 */
export async function PUT(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const raw = (await req.json().catch(() => null)) as ({ confirmPassword?: unknown } & Record<string, unknown>) | null;
  if (!raw || typeof raw !== "object") return Response.json({ error: "invalid_request" }, { status: 400 });
  const { confirmPassword, ...settings } = raw;
  if (typeof confirmPassword !== "string" || !confirmPassword) return Response.json({ error: "password", message: "enter your password to save these settings" }, { status: 400 });
  try {
    await confirmOwnPassword(getDb(), user, confirmPassword);
    await updateOrgSettings(getDb(), user, settings);
    return Response.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
