"use client";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The dashboard's title row and date-range switch. Changing the range keeps the page where it is and dims it while the new numbers
 * load (no blank skeleton, no jump), and the refresh button reloads the numbers in place.
 */
export function DashboardFrame({ title, description, days, ranges, children }: { title: string; description: string; days: number; ranges: number[]; children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (n: number) => start(() => router.replace(`/dashboard?days=${n}`, { scroll: false }));
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => start(() => router.refresh())} aria-label="Refresh the numbers" title="Refresh"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} aria-hidden />
          </button>
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Date range">
            {ranges.map((r) => (
              <button key={r} type="button" aria-pressed={r === days} onClick={() => go(r)}
                className={cn("rounded-md px-3 py-1.5 text-sm transition-colors", r === days ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{r}d</button>
            ))}
          </div>
        </div>
      </div>
      <div aria-busy={pending} className={cn("transition-opacity duration-200", pending && "pointer-events-none opacity-60")}>{children}</div>
    </>
  );
}
