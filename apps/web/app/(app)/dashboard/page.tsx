import { Clock, Gauge, Phone, Smile } from "lucide-react";
import Link from "next/link";
import { dashboardStats, listCalls } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { CallStatusBadge, LeadStatusBadge, SentimentBadge, SourceBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StackedBarChart } from "@/components/ui/bar-chart";
import { Notice, PageHeader, Stat } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { cn, formatDuration, formatDateTime, pct } from "@/lib/utils";

const RANGES = [7, 14, 30];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requirePageUser();
  const days = RANGES.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 7;
  const stats = await allowed(() => dashboardStats(getDb(), user, days));
  if (!stats) return <Forbidden />;
  const { totals, series, leadsByStatus, aggregateOnly } = stats;
  const recent = aggregateOnly ? null : await allowed(() => listCalls(getDb(), user, {}, 8));

  const sentiment = totals.avgSentiment;
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Last ${days} days${aggregateOnly ? " · summary view" : ""}`}
        actions={
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={`/dashboard?days=${r}`} className={cn("rounded-md px-3 py-1 text-sm", r === days ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{r}d</Link>
            ))}
          </div>
        }
      />
      {aggregateOnly && <div className="mb-6"><Notice>You have a summary-only view. Individual calls, leads and recordings are not shown for your role.</Notice></div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total calls" value={totals.total} hint={`${totals.connected} connected · ${totals.missed} missed`} icon={Phone} />
        <Stat label="Connect rate" value={`${pct(totals.connected, totals.total)}%`} hint={`Talk time ${formatDuration(totals.talkSeconds)}`} icon={Gauge} />
        <Stat label="Handled by AI" value={`${pct(totals.ai, totals.total)}%`} hint={`${totals.ai} AI calls · ${totals.handoffs} handed to a person`} icon={Clock} />
        <Stat label="Average sentiment" value={sentiment === null ? "—" : sentiment.toFixed(2)} hint={sentiment === null ? "No analysed calls yet" : sentiment > 0.2 ? "Mostly positive" : sentiment < -0.2 ? "Mostly negative" : "Mostly neutral"} icon={Smile} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Calls per day" description="By how the call was made" />
          <CardBody>
            <StackedBarChart
              data={series}
              series={[
                { key: "ai", label: "AI assistant", color: "var(--chart-ai)" },
                { key: "web", label: "Web dialer", color: "var(--chart-human)" },
                { key: "mobile", label: "Agent mobile SIM", color: "var(--chart-mobile)" },
              ]}
            />
          </CardBody>
        </Card>

        {leadsByStatus && (
          <Card>
            <CardHeader title="Leads by status" />
            <CardBody className="grid gap-3">
              {(() => {
                const total = leadsByStatus.reduce((s, r) => s + r.n, 0);
                return leadsByStatus.sort((a, b) => b.n - a.n).map((r) => (
                  <div key={r.status}>
                    <div className="mb-1 flex items-center justify-between text-sm"><LeadStatusBadge status={r.status} /><span className="tabular-nums text-muted-foreground">{r.n}</span></div>
                    <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct(r.n, total)}%` }} /></div>
                  </div>
                ));
              })()}
            </CardBody>
          </Card>
        )}
      </div>

      {recent && (
        <Card className="mt-6">
          <CardHeader title="Recent calls" action={<Link href="/calls" className={buttonClass({ variant: "outline", size: "sm" })}>View all</Link>} />
          <Table>
            <thead><tr><Th>When</Th><Th>Lead</Th><Th>Source</Th><Th>Status</Th><Th>Duration</Th><Th>Sentiment</Th></tr></thead>
            <tbody>
              {recent.rows.map((c) => (
                <Tr key={c.id}>
                  <Td><Link className="text-primary hover:underline" href={`/calls/${c.id}`}>{formatDateTime(c.startedAt)}</Link></Td>
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
    </>
  );
}
