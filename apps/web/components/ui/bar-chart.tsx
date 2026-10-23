type Series = { key: string; label: string; color: string };

/** Stacked bars, dependency-free. `data` rows carry a label and one number per series key. */
export function StackedBarChart({ data, series, height = 180 }: { data: Array<Record<string, number | string>>; series: Series[]; height?: number }) {
  const totals = data.map((d) => series.reduce((s, x) => s + Number(d[x.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label="Calls per day by source">
        {data.map((d, i) => (
          <div key={String(d.label)} className="group flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${totals[i]} calls`}>
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(totals[i]! / max) * 100}%` }}>
              {series.map((s) => (
                <div key={s.key} style={{ height: `${totals[i] ? (Number(d[s.key] ?? 0) / totals[i]!) * 100 : 0}%`, background: s.color }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 text-[10px] text-muted-foreground">
        {data.map((d) => <div key={String(d.label)} className="flex-1 truncate text-center">{d.label}</div>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
