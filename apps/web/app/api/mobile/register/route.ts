import { registerDevice } from "@voiceai/db";
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
    return Response.json({ deviceId: device.deviceId, token: device.token, email: device.email });
  } catch (err) {
    return toResponse(err);
  }
}
