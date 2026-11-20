"use client";
import { BarChart3, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { T } from "../t";

export interface DayRow { label: string; day: string; ai: number; web: number; mobile: number }

/** Three sources, three hues (blue, teal, amber), checked for colour-blind separation and contrast in light and dark. */
const SERIES = [
  { key: "ai", label: "AI assistant", color: "var(--chart-ai)", source: "ai" },
  { key: "web", label: "Web dialer", color: "var(--chart-human)", source: "web_dialer" },
  { key: "mobile", label: "Agent mobile SIM", color: "var(--chart-mobile)", source: "mobile_sim" },
] as const;
type Key = (typeof SERIES)[number]["key"];

const niceMax = (n: number) => { if (n <= 4) return 4; const p = 10 ** Math.floor(Math.log10(n)); return Math.ceil(n / (p / 2)) * (p / 2); };

/**
 * Calls per day, stacked by how the call was made.
 *  - Hover or focus a day: one tooltip lists every source for that day.
 *  - Click a day: opens that day's calls. Click a coloured segment: that day, that source.
 *  - Click a legend item: hides or shows that source (the bars rescale).
 *  - "Table" shows the same numbers as text, for screen readers and for anyone who prefers it.
 */
export function CallsChart({ data, height = 220 }: { data: DayRow[]; height?: number }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<ReadonlySet<Key>>(new Set());
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<number | null>(null);

  const shown = SERIES.filter((s) => !hidden.has(s.key));
  const totalOf = (d: DayRow) => shown.reduce((n, s) => n + d[s.key], 0);
  const max = useMemo(() => niceMax(Math.max(0, ...data.map(totalOf))), [data, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const sums = SERIES.map((s) => data.reduce((n, d) => n + d[s.key], 0));
  const step = Math.ceil(data.length / 8);
  const toggle = (k: Key) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else if (shown.length > 1) n.add(k); return n; }); // never hide the last one
  const open = (day: string, source?: string) => router.push(`/calls?day=${day}${source ? `&source=${source}` : ""}`);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show or hide a source">
          {SERIES.map((s, i) => {
            const on = !hidden.has(s.key);
            return (
              <button key={s.key} type="button" aria-pressed={on} onClick={() => toggle(s.key)}
                className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                  on ? "border-border bg-card text-foreground hover:bg-muted" : "border-dashed border-border text-muted-foreground line-through hover:bg-muted")}>
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: on ? s.color : "transparent", boxShadow: on ? undefined : `inset 0 0 0 1.5px ${s.color}` }} aria-hidden />
                <T>{s.label}</T>
                <span className="tabular-nums text-muted-foreground">{sums[i]}</span>
              </button>
            );
          })}
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="group" aria-label="Chart or table">
          {([["chart", "Chart", BarChart3], ["table", "Table", Table2]] as const).map(([v, t, Icon]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1", view === v ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="h-3.5 w-3.5" aria-hidden />{t}
            </button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-start text-xs text-muted-foreground"><th className="py-2 pe-4 font-medium"><T>Day</T></th>{SERIES.map((s) => <th key={s.key} className="py-2 pe-4 text-end font-medium"><T>{s.label}</T></th>)}<th className="py-2 text-end font-medium"><T>Total</T></th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                  <td className="py-1.5 pe-4"><button type="button" onClick={() => open(d.day)} className="text-primary hover:underline">{d.label}</button></td>
                  {SERIES.map((s) => <td key={s.key} className="py-1.5 pe-4 text-end tabular-nums">{d[s.key]}</td>)}
                  <td className="py-1.5 text-end font-medium tabular-nums">{d.ai + d.web + d.mobile}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="relative flex" style={{ height }}>
            <div className="relative w-8 shrink-0 text-[10px] tabular-nums text-muted-foreground" aria-hidden>
              {[1, 0.5, 0].map((f) => <span key={f} className="absolute end-1 -translate-y-1/2" style={{ top: `${(1 - f) * 100}%` }}>{Math.round(max * f)}</span>)}
            </div>
            <div className="relative min-w-0 flex-1">
              {[0, 0.5, 1].map((f) => <div key={f} className="absolute inset-x-0 border-t border-border/70" style={{ top: `${f * 100}%`, borderStyle: f === 1 ? "solid" : "dashed" }} aria-hidden />)}
              <div className="absolute inset-0 grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }} onMouseLeave={() => setActive(null)}>
                {data.map((d, i) => {
                  const total = totalOf(d);
                  const tipRight = i > data.length / 2;
                  return (
                    <div key={d.day} className="relative h-full">
                      <button type="button" onClick={() => open(d.day)} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                        aria-label={`${d.label}: ${total} calls (${shown.map((s) => `${d[s.key]} ${s.label}`).join(", ")}). Open this day's calls.`}
                        className={cn("group flex h-full w-full cursor-pointer flex-col justify-end rounded-md px-px transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", active === i && "bg-primary-soft/70")}>
                        {total === 0 ? <span className="mx-auto mb-px h-[2px] w-3/4 rounded-full bg-border" aria-hidden /> : (
                          <span className="flex w-full flex-col-reverse overflow-hidden rounded-t-[5px] motion-safe:transition-[height] motion-safe:duration-300" style={{ height: `${(total / max) * 100}%` }}>
                            {shown.map((s, k) => d[s.key] > 0 && (
                              <span key={s.key} role="presentation" onClick={(e) => { e.stopPropagation(); open(d.day, s.source); }}
                                className="block w-full transition-[filter] hover:brightness-110"
                                style={{ height: `${(d[s.key] / total) * 100}%`, minHeight: 3, background: s.color, borderTop: k > 0 ? "2px solid var(--card)" : undefined, boxSizing: "border-box" }} />
                            ))}
                          </span>
                        )}
                      </button>
                      {active === i && (
                        <div role="status" className={cn("pointer-events-none absolute z-10 w-44 rounded-lg border border-border bg-card p-3 text-xs shadow-lg", tipRight ? "end-0" : "start-0")} style={{ bottom: `calc(${Math.min(95, (total / max) * 100)}% + 8px)` }}>
                          <div className="text-muted-foreground">{d.label}</div>
                          <div className="mb-1.5 text-lg font-semibold leading-tight tabular-nums">{total}<span className="ms-1 text-xs font-normal text-muted-foreground"><T>calls</T></span></div>
                          {SERIES.map((s) => (
                            <div key={s.key} className={cn("flex items-center justify-between gap-2 py-0.5", hidden.has(s.key) && "opacity-40")}>
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-[3px] w-3 rounded-full" style={{ background: s.color }} aria-hidden />{s.label}</span>
                              <span className="font-semibold tabular-nums text-foreground">{d[s.key]}</span>
                            </div>
                          ))}
                          <div className="mt-1.5 border-t border-border pt-1.5 text-[10px] text-muted-foreground"><T>Click to open these calls</T></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex ps-8" aria-hidden>
            <div className="grid min-w-0 flex-1 gap-1 text-[10px] text-muted-foreground sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
              {data.map((d, i) => <div key={d.day} className={cn("mt-2 flex justify-center whitespace-nowrap", active === i && "font-medium text-foreground")}>{(data.length - 1 - i) % step === 0 ? d.label : null}</div>)}
            </div>
          </div>
          <p className="mt-5 text-xs text-muted-foreground"><T>Click a day to open its calls, or a coloured part to open just that source. Click a name above to hide it.</T></p>
        </>
      )}
    </div>
  );
}
