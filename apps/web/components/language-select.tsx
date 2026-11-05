"use client";
import { useRouter } from "next/navigation";
import { LANG_COOKIE } from "@/lib/i18n";

/** Chooses the interface language. Kept in a cookie, so the server renders the page in it (no flash). */
export function LanguageSelect({ initial, label, options }: { initial: string; label: string; options: { code: string; name: string }[] }) {
  const router = useRouter();
  return (
    <select
      aria-label={label} title={label} value={initial}
      className="h-8 rounded-md border border-border bg-background px-1.5 text-xs"
      onChange={(e) => { document.cookie = `${LANG_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`; router.refresh(); }}
    >
      {options.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  );
}
