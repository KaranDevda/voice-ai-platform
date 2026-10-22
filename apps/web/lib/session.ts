import { jwtVerify, SignJWT } from "jose";

// Edge-safe (used by middleware): only jose, no Node APIs.

export const SESSION_COOKIE = "session";
export const ENROLL_COOKIE = "mfa_enroll";
/** SOP: 12 h idle timeout. The middleware re-issues the cookie on every request, so this slides. */
export const SESSION_TTL_S = 12 * 60 * 60;
export const ENROLL_TTL_S = 10 * 60;

export interface SessionClaims {
  sub: string;
  org: string;
}
export interface EnrollClaims extends SessionClaims {
  /** Present once the user has started enrolment. */
  secret?: string;
}

const key = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
};

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export const signToken = (claims: SessionClaims | EnrollClaims, ttlS: number, kind: "session" | "enroll") =>
  new SignJWT({ ...claims, kind })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlS}s`)
    .sign(key());

export async function verifyToken<T extends SessionClaims>(token: string | undefined, kind: "session" | "enroll"): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.kind === kind ? (payload as unknown as T) : null;
  } catch {
    return null;
  }
}
