import "server-only";
import { cookies } from "next/headers";
import { listEnabledExtraLanguages, translationOverridesFor, type ExtraLanguage } from "@voiceai/db";
import { LANGUAGES, LANG_COOKIE, RTL, fmt, tr } from "./i18n";
import { getDb } from "./server";
import { SESSION_COOKIE, verifyToken, type SessionClaims } from "./session";

/** What staff added (extra languages, changed words) is read from the database at most every 15 seconds, so a page never waits on it twice. */
const TTL_MS = 15_000;
interface I18nCache { extras: Map<string, { at: number; v: ExtraLanguage[] }>; over: Map<string, { at: number; v: Record<string, string> }> }
const g = globalThis as unknown as { __i18n?: I18nCache };
// A cache left over from an older version of this code (kept across dev reloads) has a different shape: start fresh instead of trusting it.
if (!(g.__i18n?.extras instanceof Map) || !(g.__i18n?.over instanceof Map)) g.__i18n = { extras: new Map(), over: new Map() };
const cache: I18nCache = g.__i18n!;

/** The signed-in person's organisation: extra languages belong to an organisation, so before sign-in there are none. */
async function orgId(): Promise<string | null> {
  const claims = await verifyToken<SessionClaims>((await cookies()).get(SESSION_COOKIE)?.value, "session");
  return claims?.org ?? null;
}
export async function extraLanguages(): Promise<ExtraLanguage[]> {
  const org = await orgId();
  if (!org) return [];
  const hit = cache.extras.get(org);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const v = await listEnabledExtraLanguages(getDb(), org).catch(() => hit?.v ?? []);
  cache.extras.set(org, { at: Date.now(), v });
  return v;
}
export async function overridesFor(lang: string): Promise<Record<string, string>> {
  if (lang === "en") return {};
  const org = await orgId();
  if (!org) return {};
  const key = `${org}|${lang}`;
  const hit = cache.over.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const v = await translationOverridesFor(getDb(), org, lang).catch(() => hit?.v ?? {});
  cache.over.set(key, { at: Date.now(), v });
  return v;
}
/** The language in the visitor's cookie when it is one we have (built in or added by staff), else English. */
export async function currentLang(): Promise<string> {
  const c = (await cookies()).get(LANG_COOKIE)?.value ?? "en";
  return LANGUAGES.some((l) => l.code === c) || (await extraLanguages()).some((l) => l.code === c) ? c : "en";
}
export async function languageOptions(): Promise<{ code: string; name: string }[]> {
  return [...LANGUAGES.map((l) => ({ code: l.code, name: l.name })), ...(await extraLanguages()).map((l) => ({ code: l.code, name: l.name }))];
}
export async function isRtl(lang: string): Promise<boolean> {
  return (RTL as readonly string[]).includes(lang) || (await extraLanguages()).some((l) => l.code === lang && l.rtl);
}
/** `text` in the visitor's language: a word staff changed, else the built-in translation, else English. */
export async function trServer(text: string, vars?: Record<string, string | number>): Promise<string> {
  const lang = await currentLang();
  return fmt((await overridesFor(lang))[text] ?? tr(lang, text), vars);
}
