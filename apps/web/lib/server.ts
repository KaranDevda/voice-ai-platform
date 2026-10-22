import "server-only";
import { cookies, headers } from "next/headers";
import { createDb, loadAuthUser, type Db } from "@voiceai/db";
import { parseKey, type AuthUser } from "@voiceai/auth";
import { createElevenLabsTts } from "@voiceai/providers";
import { SESSION_COOKIE, verifyToken, type SessionClaims } from "./session";

const g = globalThis as unknown as { __db?: Db };

export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return (g.__db ??= createDb(url).db);
}

export const encryptionKey = () => {
  const k = process.env.MFA_ENCRYPTION_KEY;
  if (!k) throw new Error("MFA_ENCRYPTION_KEY is required");
  return parseKey(k);
};

/** Current user, reloaded from the DB so suspension and role changes apply immediately. */
export async function getAuthUser(): Promise<AuthUser | null> {
  const claims = await verifyToken<SessionClaims>((await cookies()).get(SESSION_COOKIE)?.value, "session");
  return claims ? loadAuthUser(getDb(), claims.org, claims.sub) : null;
}

/** CSRF defence for mutations, on top of SameSite=Lax: the Origin header must match the Host. */
export async function assertSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  return !!origin && new URL(origin).host === h.get("host");
}

export async function clientMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined };
}

/** Authenticated user or a 401 response; route handlers do `if (auth instanceof Response) return auth`. */
export async function requireUser(): Promise<AuthUser | Response> {
  const user = await getAuthUser();
  return user ?? Response.json({ error: "unauthenticated" }, { status: 401 });
}

export function getTts() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is required");
  return createElevenLabsTts({ apiKey, baseUrl: process.env.ELEVENLABS_BASE_URL, modelId: process.env.ELEVENLABS_MODEL_ID });
}
