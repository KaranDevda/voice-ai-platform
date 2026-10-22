import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, SESSION_COOKIE, SESSION_TTL_S, signToken, verifyToken, type SessionClaims } from "./lib/session";

const PUBLIC = [/^\/login$/, /^\/api\/auth\/(login|mfa\/.*)$/];

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
