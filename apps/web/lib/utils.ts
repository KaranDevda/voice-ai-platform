import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Which Intl locale each interface language uses. A language staff added uses its own code when the runtime knows it. */
const LOCALES: Record<string, string> = { en: "en-IN", es: "es", fr: "fr", ar: "ar", zh: "zh-CN", hi: "hi-IN", pt: "pt-BR", ru: "ru", ja: "ja", de: "de" };
const fmtCache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>();
export function localeOf(lang = "en"): string {
  const l = LOCALES[lang] ?? lang;
  try { return Intl.DateTimeFormat.supportedLocalesOf(l).length ? l : "en-IN"; } catch { return "en-IN"; }
}
function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(key: string, make: () => T): T {
  let f = fmtCache.get(key) as T | undefined;
  if (!f) { f = make(); fmtCache.set(key, f); }
  return f;
}
/** A date and time in the language's own format (Indian time), e.g. "19 Nov, 12:17 pm" in English and "19 nov., 12:17" in French. */
export const formatDateTime = (d: Date | string, lang = "en") => { const l = localeOf(lang); return cached(`dt|${l}`, () => new Intl.DateTimeFormat(l, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })).format(new Date(d)); };
export const formatDate = (d: Date | string, lang = "en") => { const l = localeOf(lang); return cached(`d|${l}`, () => new Intl.DateTimeFormat(l, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })).format(new Date(d)); };
export const formatTime = (d: Date | string, lang = "en") => { const l = localeOf(lang); return cached(`t|${l}`, () => new Intl.DateTimeFormat(l, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" })).format(new Date(d)); };
/** A number with the language's digit grouping (and digits). */
export const formatNumber = (n: number, lang = "en") => { const l = localeOf(lang); return cached(`n|${l}`, () => new Intl.NumberFormat(l)).format(n); };

export function timeAgo(d: Date | string, now = Date.now(), lang = "en"): string {
  const diff = Math.max(0, now - new Date(d).getTime()) / 1000;
  const l = localeOf(lang);
  const rtf = cached(`r|${l}`, () => new Intl.RelativeTimeFormat(l, { numeric: "auto", style: "short" }));
  if (diff < 60) return lang === "en" ? "just now" : rtf.format(0, "second");
  if (diff < 3600) return lang === "en" ? `${Math.floor(diff / 60)}m ago` : rtf.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return lang === "en" ? `${Math.floor(diff / 3600)}h ago` : rtf.format(-Math.floor(diff / 3600), "hour");
  return lang === "en" ? `${Math.floor(diff / 86400)}d ago` : rtf.format(-Math.floor(diff / 86400), "day");
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const clockMs = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
