import "server-only";
import { cookies } from "next/headers";
import { listExtraLanguages, translationOverrides, type ExtraLanguage } from "@voiceai/db";
import { LANGUAGES, LANG_COOKIE, RTL, tr } from "./i18n";
import { getDb } from "./server";

/** What staff added (extra languages, changed words) is read from the database at most every 15 seconds, so a page never waits on it twice. */
const TTL_MS = 15_000;
interface I18nCache { extras?: { at: number; v: ExtraLanguage[] }; over: Map<string, { at: number; v: Record<string, string> }> }
const g = globalThis as unknown as { __i18n?: I18nCache };
const cache: I18nCache = (g.__i18n ??= { over: new Map() });

export async function extraLanguages(): Promise<ExtraLanguage[]> {
  if (cache.extras && Date.now() - cache.extras.at < TTL_MS) return cache.extras.v;
  const v = await listExtraLanguages(getDb()).catch(() => cache.extras?.v ?? []);
  cache.extras = { at: Date.now(), v };
  return v;
}
export async function overridesFor(lang: string): Promise<Record<string, string>> {
  if (lang === "en") return {};
  const hit = cache.over.get(lang);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const v = await translationOverrides(getDb(), lang).catch(() => hit?.v ?? {});
  cache.over.set(lang, { at: Date.now(), v });
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
export async function trServer(text: string): Promise<string> {
  const lang = await currentLang();
  return (await overridesFor(lang))[text] ?? tr(lang, text);
}
