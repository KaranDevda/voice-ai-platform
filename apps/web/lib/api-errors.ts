import "server-only";
import { ForbiddenError } from "@voiceai/auth";
import { AdminError, IntegrationError, ProfitError, BillingError, CampaignError, MessagingError, VoiceProfileError, WidgetError, PasswordError, ContentError } from "@voiceai/db";
import { ProviderError, UnsafeUrlError } from "@voiceai/providers";
import { ZodError } from "zod";
import { NotConfiguredError } from "./providers";

/** Maps domain errors to HTTP responses; anything unexpected is rethrown as a 500. */
export function toResponse(err: unknown): Response {
  if (err instanceof ForbiddenError) return Response.json({ error: "forbidden" }, { status: 403 });
  if (err instanceof ZodError) return Response.json({ error: "invalid_request", issues: err.issues }, { status: 400 });
  if (err instanceof ProfitError) return Response.json({ error: "profit", message: err.message }, { status: 409 });
  if (err instanceof IntegrationError) return Response.json({ error: "integration", message: err.message }, { status: 409 });
  if (err instanceof UnsafeUrlError) return Response.json({ error: "integration", message: err.message }, { status: 409 });
  if (err instanceof AdminError) return Response.json({ error: "admin", message: err.message }, { status: 409 });
  if (err instanceof BillingError) return Response.json({ error: "billing", message: err.message }, { status: 402 });
  if (err instanceof MessagingError) return Response.json({ error: "messaging", message: err.message }, { status: 409 });
  if (err instanceof PasswordError) return Response.json({ error: "password", message: err.message }, { status: 400 });
  if (err instanceof ContentError) return Response.json({ error: "content", message: err.message }, { status: 409 });
  if (err instanceof WidgetError) return Response.json({ error: "widget", message: err.message }, { status: 409 });
  if (err instanceof CampaignError) return Response.json({ error: "campaign", message: err.message }, { status: 409 });
  if (err instanceof VoiceProfileError) return Response.json({ error: err.message }, { status: 409 });
  if (err instanceof RangeError) return Response.json({ error: "invalid_request", message: err.message }, { status: 400 });
  if (err instanceof NotConfiguredError) return Response.json({ error: "provider_not_configured", provider: err.provider, hint: err.hint }, { status: 503 });
  if (err instanceof ProviderError) {
    // 401/402/403 from a provider mean our account is the problem, not the caller's request.
    return Response.json({ error: "provider_error", provider: err.provider, status: err.status, message: err.message }, { status: 502 });
  }
  if (err instanceof Error && (err.name === "TimeoutError" || /fetch failed|ECONN|ENOTFOUND|EHOSTUNREACH/.test(err.message))) {
    return Response.json({ error: "provider_unreachable", message: err.message }, { status: 502 });
  }
  throw err;
}
