import { cookies } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import { BizfyMark } from "@/components/brand";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { LogoutButton } from "@/components/logout-button";
import { NavLinks } from "@/components/nav-links";
import { LanguageSelect } from "@/components/language-select";
import { I18nProvider } from "@/components/t";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { navFor, profileOf, requirePageUser } from "@/lib/page-auth";
import { TRANSLATABLE, tr } from "@/lib/i18n";
import { currentLang, languageOptions, overridesFor } from "@/lib/i18n-server";
import { SESSION_COOKIE, verifyToken, type SessionClaims } from "@/lib/session";
import { titleCase } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Black or white text, whichever reads better on the colour (a strict #rrggbb, already checked by the settings schema). */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? "#000000" : "#ffffff";
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  const [profile, rawGroups, jar] = [await profileOf(user), navFor(user), await cookies()];
  const lang = await currentLang();
  const over = await overridesFor(lang);
  const t = (text: string) => over[text] ?? tr(lang, text);
  const groups = rawGroups.map((g) => ({ label: t(g.label), items: g.items.map((i) => ({ ...i, label: t(i.label) })) }));
  const dict = Object.fromEntries(TRANSLATABLE.map((k) => [k, t(k)] as const).filter(([k, v]) => v && v !== k));
  const langOptions = await languageOptions();
  const brand = profile.brand;
  const brandStyle = brand.primary
    ? ({ "--primary": brand.primary, "--wave": brand.primary, "--primary-soft": `color-mix(in srgb, ${brand.primary} 18%, var(--background))`, "--primary-foreground": readableOn(brand.primary) } as CSSProperties)
    : undefined;
  const theme = jar.get("theme")?.value === "light" ? "light" : "dark";
  const impersonating = !!(await verifyToken<SessionClaims>(jar.get(SESSION_COOKIE)?.value, "session"))?.impBy;

  return (
    <I18nProvider dict={dict}>
    <div className="min-h-screen md:flex md:flex-wrap" style={brandStyle}>
      {impersonating && <div className="w-full"><ImpersonationBanner email={profile.email} /></div>}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-border bg-card md:flex">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <BizfyMark className="h-9 w-9" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">{brand.name || "Bizfy Voice AI"}</div>
            <div className="text-xs text-muted-foreground">{brand.tagline || t("Calls · voices · agents")}</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4"><NavLinks groups={groups} orientation="vertical" /></div>
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <div className="truncate font-medium text-foreground">{profile.email}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">{profile.roles.map((r) => <Badge key={r} tone="primary">{titleCase(r)}</Badge>)}</div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-card/70 px-4 py-3 backdrop-blur md:px-8">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{profile.orgName}</div>
            <div className="truncate text-xs text-muted-foreground md:hidden">{profile.email}</div>
          </div>
          <div className="flex items-center gap-1"><a href="/account" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">{t("Account")}</a><LanguageSelect initial={lang} label={t("Language")} options={langOptions} /><ThemeToggle initial={theme} /><LogoutButton /></div>
        </header>
        <div className="border-b border-border bg-card md:hidden"><NavLinks groups={groups} orientation="horizontal" /></div>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
    </I18nProvider>
  );
}
