import "server-only";
import { writeAppErrorOrg } from "@voiceai/db";
import { getDb } from "./server";
import { SESSION_COOKIE, verifyToken, type SessionClaims } from "./session";

const SENSITIVE = /^(cookie|authorization|x-api-key)$/i;

/** Saves an unhandled server error with the route, method and a safe copy of the headers. Needs a signed-in session (the log is per organisation). */
export async function recordServerError(err: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }) {
  const cookie = String(request.headers.cookie ?? "");
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const claims = await verifyToken<SessionClaims>(token, "session");
  if (!claims) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([k]) => !SENSITIVE.test(k)).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]));
  await writeAppErrorOrg(getDb(), {
    orgId: claims.org, userId: claims.sub, route: request.path.split("?")[0]!.slice(0, 256), method: request.method.slice(0, 10),
    errorMessage: e.message.slice(0, 2000) || "Unhandled error", errorStack: e.stack?.slice(0, 10000) ?? null,
    requestHeaders: headers, userAgent: String(request.headers["user-agent"] ?? "").slice(0, 512) || null,
  });
}
