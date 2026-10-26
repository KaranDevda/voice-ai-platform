/**
 * Which web pages may open a voice stream. A browser always sends its page's address as Origin on a WebSocket, so a
 * page on another site cannot start a call with a stolen token. Local development uses either port 3000 or 3001.
 */
export function allowedOrigins(setting: string | undefined): Set<string> {
  const list = (setting ?? "http://localhost:3000,http://localhost:3001").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const out = new Set<string>();
  for (const o of list) {
    out.add(o);
    // localhost and 127.0.0.1 are the same machine; accept whichever the developer typed.
    if (o.includes("//localhost")) out.add(o.replace("//localhost", "//127.0.0.1"));
    if (o.includes("//127.0.0.1")) out.add(o.replace("//127.0.0.1", "//localhost"));
  }
  return out;
}

/** A missing Origin means a non-browser client (a phone carrier, a test script); the signed token still has to be valid. */
export const originAllowed = (origin: string | undefined, allowed: Set<string>) => !origin || allowed.has(origin.replace(/\/$/, ""));
