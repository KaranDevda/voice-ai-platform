/** Shown the instant a sidebar link is tapped, while the page's data loads on the server. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy aria-label="Loading">
      <div className="h-8 w-56 rounded-lg bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-28 rounded-xl border border-border bg-card" />)}
      </div>
    </div>
  );
}
