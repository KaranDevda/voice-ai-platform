import "server-only";
import { NextResponse } from "next/server";
import type { cookies } from "next/headers";
import { cookieOptions, SESSION_COOKIE, SESSION_TTL_S, signToken } from "./session";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function startSession(jar: Awaited<ReturnType<typeof cookies>>, claims: { sub: string; org: string }) {
  jar.set(SESSION_COOKIE, await signToken(claims, SESSION_TTL_S, "session"), cookieOptions(SESSION_TTL_S));
}
