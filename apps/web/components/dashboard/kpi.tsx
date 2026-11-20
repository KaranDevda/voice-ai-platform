import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { T } from "../t";

const TONES = {
  blue: "bg-primary-soft text-primary",
  green: "bg-success-soft text-success",
  teal: "bg-info-soft text-info",
  amber: "bg-warning-soft text-warning",
} as const;
export type KpiTone = keyof typeof TONES;

/** A headline number that is also a link to the list behind it. The icon colour matches what the number is about. */
export function Kpi({ href, label, value, hint, icon: Icon, tone, children }: { href?: string; label: string; value: string | number; hint: string; icon: LucideIcon; tone: KpiTone; children?: React.ReactNode }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-muted-foreground"><T>{label}</T></span>
        <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg", TONES[tone])}><Icon className="h-4 w-4" aria-hidden /></span>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {children}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span><T>{hint}</T></span>
        {href && <ArrowUpRight className="rtl-flip h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
      </div>
    </>
  );
  const cls = "group block min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm transition-all";
  return href
    ? <Link href={href} className={cn(cls, "hover:-translate-y-px hover:border-primary/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary")}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** A thin share bar (0 to 100) under a headline number. */
export function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(value)} percent`}>
      <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

/** Sentiment runs from -1 (negative) to +1 (positive): a marker on a red-to-green track with a neutral middle. */
export function SentimentGauge({ value }: { value: number | null }) {
  const at = value === null ? 50 : ((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100;
  return (
    <div className="mt-3" dir="ltr" role="img" aria-label={value === null ? "No analysed calls yet" : `Sentiment ${value.toFixed(2)} on a scale from -1 to +1`}>
      <div className="relative h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, var(--danger) 0%, var(--border) 50%, var(--success) 100%)", opacity: value === null ? 0.35 : 1 }}>
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow motion-safe:transition-[left] motion-safe:duration-500" style={{ left: `${at}%` }} />
      </div>
    </div>
  );
}
