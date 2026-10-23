import "server-only";
import { ForbiddenError } from "@voiceai/auth";
import { VoiceProfileError } from "@voiceai/db";
import { ProviderError } from "@voiceai/providers";
import { ZodError } from "zod";
import { NotConfiguredError } from "./providers";

/** Maps domain errors to HTTP responses; anything unexpected is rethrown as a 500. */
export function toResponse(err: unknown): Response {
  if (err instanceof ForbiddenError) return Response.json({ error: "forbidden" }, { status: 403 });
  if (err instanceof ZodError) return Response.json({ error: "invalid_request", issues: err.issues }, { status: 400 });
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
