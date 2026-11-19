/** Next calls this for every unhandled error on the server (API routes and pages). It is recorded in the Error log for the signed-in person's organisation. */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recordServerError } = await import("./lib/record-error");
    await recordServerError(err, request);
  } catch {
    // Logging must never make a failing request worse.
  }
}
