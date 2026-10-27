import { Clock, Gauge, Phone, Smile } from "lucide-react";
import Link from "next/link";
import { countFailedAnalyses, dashboardStats, listCalls } from "@voiceai/db";
import { CallsChart } from "@/components/dashboard/calls-chart";
import { DashboardFrame } from "@/components/dashboard/dashboard-frame";
import { Kpi, Meter, SentimentGauge } from "@/components/dashboard/kpi";
import { Forbidden } from "@/components/forbidden";
import { CallStatusBadge, SentimentBadge, SourceBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDuration, formatDateTime, pct, titleCase } from "@/lib/utils";

/** One colour per lead status, matching the status badges elsewhere in the app. */
const STATUS_COLOR: Record<string, string> = {
  new: "var(--primary)", contacted: "var(--info)", interested: "var(--chart-human)", callback_requested: "var(--warning)",
  not_interested: "var(--danger)", won: "var(--success)", lost: "var(--muted-foreground)",
};

const RANGES = [7, 14, 30];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requirePageUser();
  const days = RANGES.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 7;
  const stats = await allowed(() => dashboardStats(getDb(), user, days));
  if (!stats) return <Forbidden />;
  const { totals, series, leadsByStatus, aggregateOnly } = stats;
  const recent = aggregateOnly ? null : await allowed(() => listCalls(getDb(), user, {}, 8));

  const failedAnalyses = aggregateOnly ? 0 : await allowed(() => countFailedAnalyses(getDb(), user)) ?? 0;
  const sentiment = totals.avgSentiment;
  const peak = series.reduce((m, d) => (d.ai + d.web + d.mobile > m.n ? { n: d.ai + d.web + d.mobile, label: d.label } : m), { n: 0, label: "" });
  const connectRate = pct(totals.connected, totals.total), aiShare = pct(totals.ai, totals.total);

  return (
    <DashboardFrame title="Dashboard" description={`Last ${days} days${aggregateOnly ? " · summary view" : ""}`} days={days} ranges={RANGES}>
      {aggregateOnly && <div className="mb-6"><Notice>You have a summary-only view. Individual calls, leads and recordings are not shown for your role.</Notice></div>}

      {failedAnalyses > 0 && <div className="mb-6"><Notice tone="warning">The AI could not analyse {failedAnalyses} call{failedAnalyses === 1 ? "" : "s"}. <Link href="/calls?analysis=failed" className="font-medium underline">See which, and try again</Link>.</Notice></div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi href={aggregateOnly ? undefined : "/calls"} label="Total calls" value={totals.total} hint={`${totals.connected} connected · ${totals.missed} missed`} icon={Phone} tone="blue" />
        <Kpi href={aggregateOnly ? undefined : "/calls?status=connected"} label="Connect rate" value={`${connectRate}%`} hint={`Talk time ${formatDuration(totals.talkSeconds)}`} icon={Gauge} tone="green"><Meter value={connectRate} color="var(--success)" /></Kpi>
        <Kpi href={aggregateOnly ? undefined : "/calls?source=ai"} label="Handled by AI" value={`${aiShare}%`} hint={`${totals.ai} AI calls · ${totals.handoffs} handed to a person`} icon={Clock} tone="teal"><Meter value={aiShare} color="var(--chart-ai)" /></Kpi>
        <Kpi label="Average sentiment" value={sentiment === null ? "—" : sentiment.toFixed(2)} hint={sentiment === null ? "No analysed calls yet" : sentiment > 0.2 ? "Mostly positive" : sentiment < -0.2 ? "Mostly negative" : "Mostly neutral"} icon={Smile} tone="amber"><SentimentGauge value={sentiment} /></Kpi>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Calls per day" description={peak.n ? `By how the call was made · busiest day ${peak.label} (${peak.n} calls)` : "By how the call was made"} />
          <CardBody><CallsChart data={series} /></CardBody>
        </Card>

        {leadsByStatus && (
          <Card>
            <CardHeader title="Leads by status" description="Click a status to open those leads" />
            <CardBody className="grid gap-1 !p-3">
              {(() => {
                const total = leadsByStatus.reduce((n, r) => n + r.n, 0);
                return [...leadsByStatus].sort((a, b) => b.n - a.n).map((r) => (
                  <Link key={r.status} href={`/leads?status=${r.status}`} className="group rounded-lg px-2 py-2 transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: STATUS_COLOR[r.status] ?? "var(--muted-foreground)" }} aria-hidden />{titleCase(r.status)}</span>
                      <span className="tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{r.n}</span> · {pct(r.n, total)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 group-hover:brightness-110" style={{ width: `${Math.max(2, pct(r.n, total))}%`, background: STATUS_COLOR[r.status] ?? "var(--muted-foreground)" }} /></div>
                  </Link>
                ));
              })()}
            </CardBody>
          </Card>
        )}
      </div>

      {recent && (
        <Card className="mt-6">
          <CardHeader title="Recent calls" description="Click a row to open the call" action={<Link href="/calls" className={buttonClass({ variant: "outline", size: "sm" })}>View all</Link>} />
          <Table>
            <thead><tr><Th>When</Th><Th>Lead</Th><Th>Source</Th><Th>Status</Th><Th>Duration</Th><Th>Sentiment</Th></tr></thead>
            <tbody>
              {recent.rows.map((c) => (
                <Tr key={c.id} className="group relative cursor-pointer">
                  <Td><Link className="text-primary after:absolute after:inset-0 hover:underline" href={`/calls/${c.id}`}>{formatDateTime(c.startedAt)}</Link></Td>
                  <Td>{c.leadName ?? <span className="text-muted-foreground">Unknown caller</span>}<div className="text-xs text-muted-foreground">{c.leadPhone}</div></Td>
                  <Td><SourceBadge source={c.source} /></Td>
                  <Td><CallStatusBadge status={c.status} /></Td>
                  <Td className="tabular-nums">{c.durationS ? formatDuration(c.durationS) : "—"}</Td>
                  <Td><SentimentBadge label={c.sentimentLabel} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </DashboardFrame>
  );
}
