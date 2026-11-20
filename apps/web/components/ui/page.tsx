import { T } from "../t";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";


export function Stat({ label, value, hint, icon: Icon }: { label: string; value: ReactNode; hint?: string; icon?: LucideIcon }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span><T>{label}</T></span>
        {Icon && <Icon className="h-4 w-4" aria-hidden />}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground"><T>{hint}</T></div>}
    </Card>
  );
}

export function EmptyState({ title, description, icon: Icon }: { title: string; description?: string; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {Icon && <Icon className="h-8 w-8 text-muted-foreground" aria-hidden />}
      <p className="font-medium"><T>{title}</T></p>
      {description && <p className="max-w-sm text-sm text-muted-foreground"><T>{description}</T></p>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", tone === "warning" ? "border-warning/30 bg-warning-soft text-warning" : "border-info/30 bg-info-soft text-info")}>
      {children}
    </div>
  );
}

export function Pager({ basePath, params, page, hasMore }: { basePath: string; params: Record<string, string | undefined>; page: number; hasMore: boolean }) {
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    q.set("page", String(p));
    return `${basePath}?${q}`;
  };
  const cls = "rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted";
  return (
    <div className="flex items-center justify-between px-5 py-3 text-sm text-muted-foreground">
      <span><T>Page</T> {page}</span>
      <div className="flex gap-2">
        {page > 1 && <Link className={cls} href={href(page - 1)}><T>Previous</T></Link>}
        {hasMore && <Link className={cls} href={href(page + 1)}><T>Next</T></Link>}
      </div>
    </div>
  );
}
