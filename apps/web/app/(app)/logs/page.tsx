import { listUsage } from "@voiceai/db";
import { currentLang } from "@/lib/i18n-server";
import { Forbidden } from "@/components/forbidden";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Pager } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { cn, formatDateTime, pct, formatNumber } from "@/lib/utils";
import { T } from "@/components/t";

const UNIT: Record<string, string> = { speech: "chars", transcription: "sec audio", chat: "chars", clone: "—" };

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const lang = await currentLang();
  const user = await requirePageUser();
  const sp = await searchParams;
  const status = sp.status === "ok" || sp.status === "error" ? sp.status : undefined;
  const data = await allowed(() => listUsage(getDb(), user, { status, page: Number(sp.page) || 1 }));
  if (!data) return <Forbidden />;

  return (
    <>
      <PageHeader title="Provider logs" description="Every call to Deepgram, ElevenLabs and AskG1, with speed and outcome. The last 24 hours are summarised below." />
      {data.summary.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.summary.map((s) => (
            <Card key={`${s.provider}/${s.operation}`} className="p-5">
              <div className="flex items-center justify-between text-sm"><span className="font-medium capitalize">{s.provider}</span><span className="text-muted-foreground">{s.operation}</span></div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">{s.calls}</div>
              <div className="mt-1 text-xs text-muted-foreground">{Math.round(s.avgMs)} <T>ms average ·</T> {formatNumber(Math.round(s.units), lang)} <T>{UNIT[s.operation] ?? "units"}</T></div>
              <div className={cn("mt-1 text-xs", s.errors ? "text-danger" : "text-success")}><T>{s.errors ? `${s.errors} failed (${pct(s.errors, s.calls)}%)` : "No failures"}</T></div>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardHeader title="Requests" />
        <form action="/logs" className="flex items-center gap-2 border-b border-border px-5 py-3">
          <select name="status" defaultValue={status ?? ""} aria-label="Outcome" className="h-9 rounded-lg border border-border bg-card px-3 text-sm"><option value=""><T>All outcomes</T></option><option value="ok"><T>Succeeded</T></option><option value="error"><T>Failed</T></option></select>
          <button className="h-9 rounded-lg bg-primary-soft px-4 text-sm font-medium text-primary" type="submit"><T>Apply</T></button>
        </form>
        {data.rows.length === 0 ? <EmptyState title="No requests yet" description="Generate speech or transcribe audio and the calls will show up here." /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Provider</Th><Th>Operation</Th><Th>Outcome</Th><Th>Speed</Th><Th>Size</Th><Th>User</Th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDateTime(r.at, lang)}</Td><Td className="capitalize">{r.provider}</Td><Td>{r.operation}</Td>
                  <Td>{r.status === "ok" ? <Badge tone="success">OK</Badge> : <span title={r.error ?? ""}><Badge tone="danger">Failed</Badge></span>}</Td>
                  <Td className="tabular-nums">{r.latencyMs} <T>ms</T></Td><Td className="tabular-nums">{formatNumber(Math.round(r.units), lang)} {UNIT[r.operation] ?? ""}</Td><Td className="text-muted-foreground">{r.email ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager basePath="/logs" params={{ status }} page={data.page} hasMore={data.hasMore} />
      </Card>
    </>
  );
}
