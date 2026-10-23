import { Mic } from "lucide-react";
import Link from "next/link";
import { listCalls } from "@voiceai/db";
import { CALL_SOURCES, CALL_STATUSES } from "@voiceai/shared";
import { FilterBar } from "@/components/filter-bar";
import { Forbidden } from "@/components/forbidden";
import { Badge, CallStatusBadge, SentimentBadge, SourceBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pager } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, formatDuration, titleCase } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = { ai_inbound: "AI inbound", ai_outbound: "AI outbound", web_dialer: "Web dialer", mobile_sim: "Mobile SIM" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ q?: string; source?: string; status?: string; page?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const data = await allowed(() => listCalls(getDb(), user, { q: sp.q, source: sp.source, status: sp.status, page: Number(sp.page) || 1 }));
  if (!data) return <Forbidden />;

  return (
    <>
      <PageHeader title="Call logs" description="Every call, whether the AI, the web dialer or an agent's phone made it." />
      <Card>
        <FilterBar
          action="/calls"
          q={sp.q}
          selects={[
            { name: "source", value: sp.source, label: "All sources", options: CALL_SOURCES.map((s) => [s, SOURCE_LABEL[s]!]) },
            { name: "status", value: sp.status, label: "All outcomes", options: CALL_STATUSES.map((s) => [s, titleCase(s)]) },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="No calls match" description="Try clearing the filters." />
        ) : (
          <Table>
            <thead><tr><Th>When</Th><Th>Lead</Th><Th>Source</Th><Th>Direction</Th><Th>Outcome</Th><Th>Duration</Th><Th>Agent</Th><Th>Sentiment</Th><Th>Audio</Th></tr></thead>
            <tbody>
              {data.rows.map((c) => (
                <Tr key={c.id}>
                  <Td><Link className="text-primary hover:underline" href={`/calls/${c.id}`}>{formatDateTime(c.startedAt)}</Link></Td>
                  <Td>{c.leadName ?? <span className="text-muted-foreground">Unknown caller</span>}<div className="text-xs text-muted-foreground">{c.leadPhone}</div></Td>
                  <Td><div className="flex items-center gap-1.5"><SourceBadge source={c.source} />{c.handedOff && <Badge tone="warning">Handoff</Badge>}</div></Td>
                  <Td>{titleCase(c.direction)}</Td>
                  <Td><CallStatusBadge status={c.status} /></Td>
                  <Td className="tabular-nums">{c.durationS ? formatDuration(c.durationS) : "—"}</Td>
                  <Td>{c.agentEmail ?? <span className="text-muted-foreground">AI</span>}</Td>
                  <Td><SentimentBadge label={c.sentimentLabel} /></Td>
                  <Td>{c.hasRecording ? <Mic className="h-4 w-4 text-muted-foreground" aria-label="Has recording" /> : <span className="text-muted-foreground">—</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager basePath="/calls" params={{ q: sp.q, source: sp.source, status: sp.status }} page={data.page} hasMore={data.hasMore} />
      </Card>
    </>
  );
}
