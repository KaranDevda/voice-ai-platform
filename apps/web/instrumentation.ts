/**
 * Runs once when the server starts: loads the provider keys staff saved in the website (Platform > Provider keys) into this
 * process's environment, and refreshes them every minute, so a key can be changed without editing the env file.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const [{ startPlatformSecrets }, { getDb }] = await Promise.all([import("@voiceai/db"), import("./lib/server")]);
    startPlatformSecrets(getDb(), { log: (l) => console.log(l) });
  } catch (e) {
    console.warn("provider keys from the website could not be loaded:", e instanceof Error ? e.message : e);
  }
}

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
