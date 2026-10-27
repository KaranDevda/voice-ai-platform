import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, SESSION_COOKIE, SESSION_TTL_S, signToken, verifyToken, type SessionClaims } from "./lib/session";

// Brand images are static and shown on the login page, so they must load before sign-in.
// The phone app has no browser session: it sends its own device token, which each /api/mobile route checks itself.
// Voice files are fetched by the TTS server, not a browser; the route itself checks a signed address.
const PUBLIC = [/^\/login$/, /^\/api\/auth\/(login|mfa\/.*)$/, /^\/brand\/[\w.-]+\.png$/, /^\/icon\.png$/, /^\/worklets\/[\w.-]+\.js$/, /^\/api\/mobile\/(register|me|calls|leads|check-call)$/, /^\/api\/mobile\/calls\/[^/]+\/recording$/, /^\/api\/internal\/voice-files\/[0-9a-f]{64}\/[0-9a-f-]{36}(\.[a-z]{2})?\.safetensors$/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const claims = await verifyToken<SessionClaims>(req.cookies.get(SESSION_COOKIE)?.value, "session");

  if (!claims) {
    if (PUBLIC.some((p) => p.test(pathname))) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Slide the idle window.
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, await signToken({ sub: claims.sub, org: claims.org }, SESSION_TTL_S, "session"), cookieOptions(SESSION_TTL_S));
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
