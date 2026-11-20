import Link from "next/link";
import { agentProductivity } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Notice, Stat } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { cn, formatDuration, pct } from "@/lib/utils";
import { T } from "@/components/t";

const RANGES = [7, 14, 30];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requirePageUser();
  const raw = Number((await searchParams).days);
  const days = RANGES.includes(raw) ? raw : 7;
  const data = await allowed(() => agentProductivity(getDb(), user, days));
  if (!data) return <Forbidden />;
  const { totals, rows, aggregateOnly } = data;

  return (
    <>
      <PageHeader
        title="Agent reports"
        description="Calls made from the web dialer and agents' work SIMs, per agent."
        actions={
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={`/reports?days=${r}`} className={cn("rounded-md px-3 py-1 text-sm", r === days ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{r}d</Link>
            ))}
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Connected calls" value={totals.connected} />
        <Stat label="Outbound connect rate" value={`${pct(totals.outConnected, totals.outAttempts)}%`} hint={`${totals.outConnected} of ${totals.outAttempts} attempts`} />
        <Stat label="Talk time" value={formatDuration(totals.talkSeconds)} />
        <Stat label="Missed, never returned" value={totals.neverReturned} hint="No call back to that lead within 24 h" />
      </div>

      <Card className="mt-6">
        <CardHeader title="Per agent" description="Definitions follow the SOP: connect rate = connected outgoing ÷ outgoing attempts" />
        {aggregateOnly ? (
          <div className="p-5"><Notice><T>Your role sees totals only. Per-agent figures are hidden.</T></Notice></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No agent calls in this period" />
        ) : (
          <Table>
            <thead><tr><Th>Agent</Th><Th>Calls / day</Th><Th>Connected</Th><Th>Connect rate</Th><Th>Talk time</Th><Th>Missed</Th><Th>Never returned</Th><Th>Avg sentiment</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.agentId}>
                  <Td className="font-medium">{r.email}</Td>
                  <Td className="tabular-nums">{(r.connected / days).toFixed(1)}</Td>
                  <Td className="tabular-nums">{r.connected}</Td>
                  <Td className="tabular-nums">{pct(r.outConnected, r.outAttempts)}%</Td>
                  <Td className="tabular-nums">{formatDuration(r.talkSeconds)}</Td>
                  <Td className="tabular-nums">{r.missedIn}</Td>
                  <Td className={cn("tabular-nums", r.neverReturned > 0 && "font-medium text-warning")}>{r.neverReturned}</Td>
                  <Td className="tabular-nums">{r.avgSentiment === null ? "—" : r.avgSentiment.toFixed(2)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
