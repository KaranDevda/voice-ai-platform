import "server-only";
import { ForbiddenError } from "@voiceai/auth";
import { VoiceProfileError } from "@voiceai/db";
import { ZodError } from "zod";

/** Maps domain errors to HTTP responses; anything unexpected is rethrown as a 500. */
export function toResponse(err: unknown): Response {
  if (err instanceof ForbiddenError) return Response.json({ error: "forbidden" }, { status: 403 });
  if (err instanceof ZodError) return Response.json({ error: "invalid_request", issues: err.issues }, { status: 400 });
  if (err instanceof VoiceProfileError) return Response.json({ error: err.message }, { status: 409 });
  throw err;
}
