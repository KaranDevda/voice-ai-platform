import { AudioLines } from "lucide-react";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { navFor, profileOf, requirePageUser } from "@/lib/page-auth";
import { titleCase } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  const [profile, groups, jar] = [await profileOf(user), navFor(user), await cookies()];
  const theme = jar.get("theme")?.value === "light" ? "light" : "dark";

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><AudioLines className="h-5 w-5" aria-hidden /></span>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Voice AI Studio</div>
            <div className="text-xs text-muted-foreground">Calls · voices · agents</div>
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
          <div className="flex items-center gap-1"><ThemeToggle initial={theme} /><LogoutButton /></div>
        </header>
        <div className="border-b border-border bg-card md:hidden"><NavLinks groups={groups} orientation="horizontal" /></div>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
