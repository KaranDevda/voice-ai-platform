import "server-only";
import { isTwilioConfigured } from "./providers";

/** SIP trunks (BYOC) exist on Twilio installations only: a clear 409 everywhere else. */
export const twilioOnly = (): Response | null =>
  isTwilioConfigured() ? null : Response.json({ error: "twilio_only", message: "SIP trunks and BYOC are available on Twilio installations only. Ask the platform team to configure Twilio." }, { status: 409 });
