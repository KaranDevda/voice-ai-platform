import { registerDevice } from "@voiceai/db";
import { sendEmail, smtpFromEnv } from "@voiceai/providers";
import { registerDeviceSchema } from "@voiceai/shared";
import { toResponse } from "@/lib/api-errors";
import { tooManyAttempts } from "@/lib/mobile-auth";
import { clientMeta, getDb } from "@/lib/server";

/** The phone trades its pairing code for a device token (shown once). */
export async function POST(req: Request) {
  const { ip } = await clientMeta();
  if (tooManyAttempts(`pair:${ip ?? "unknown"}`)) return Response.json({ error: "too_many_attempts" }, { status: 429 });
  try {
    const input = registerDeviceSchema.parse(await req.json().catch(() => null));
    const device = await registerDevice(getDb(), input);
    // Wrong, used and expired codes look the same, so a guess learns nothing.
    if (!device) return Response.json({ error: "invalid_code" }, { status: 400 });
    if (device.isNew && device.email) {
      const smtp = smtpFromEnv();
      if (!smtp) console.warn("new-device alert not sent: SMTP_HOST and SMTP_FROM are not configured");
      else void sendEmail(smtp, {
        to: device.email,
        subject: "New phone linked to your voice AI account",
        text: `A new ${input.platform} phone${input.name ? ` (${input.name})` : ""} was linked to your account at ${new Date().toISOString()}.\n\nIf this was not you, contact your organisation administrator and ask them to revoke the device under Team & devices.`,
      }).catch((err) => console.error("new-device alert e-mail failed:", err instanceof Error ? err.message : err));
    }
    return Response.json({ deviceId: device.deviceId, token: device.token, email: device.email });
  } catch (err) {
    return toResponse(err);
  }
}
