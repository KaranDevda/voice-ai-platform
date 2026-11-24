import { Mic } from "lucide-react";
import { currentLang } from "@/lib/i18n-server";
import Link from "next/link";
import { listCallBookings, listCalls } from "@voiceai/db";
import { CALL_SOURCES, CALL_STATUSES } from "@voiceai/shared";
import { FilterBar } from "@/components/filter-bar";
import { Forbidden } from "@/components/forbidden";
import { Badge, CallStatusBadge, SentimentBadge, SourceBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Pager } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, formatDuration, titleCase } from "@/lib/utils";
import { T } from "@/components/t";

const SOURCE_LABEL: Record<string, string> = { ai_inbound: "AI inbound", ai_outbound: "AI outbound", web_dialer: "Web dialer", mobile_sim: "Mobile SIM" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ q?: string; source?: string; status?: string; day?: string; analysis?: string; page?: string }> }) {
  const lang = await currentLang();
  const user = await requirePageUser();
  const sp = await searchParams;
  const data = await allowed(() => listCalls(getDb(), user, { q: sp.q, source: sp.source, status: sp.status, day: sp.day, analysis: sp.analysis === "failed" ? "failed" : undefined, page: Number(sp.page) || 1 }));
  if (!data) return <Forbidden />;
  // Callbacks and demos the AI booked on calls (name, day and time the caller chose), newest first.
  const bookings = await listCallBookings(getDb(), user, { sinceDays: 30, limit: 20 }).catch(() => []);
  const validDay = !!sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day);
  const dayLabel = validDay ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${sp.day}T00:00:00Z`)) : "";

  return (
    <>
      <PageHeader title="Call logs" description={sp.analysis === "failed" ? "Calls the AI gave up analysing. Open one and press Try again." : validDay ? `Calls on ${dayLabel} (India time)` : "Every call, whether the AI, the web dialer or an agent's phone made it."} />
      {bookings.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Callbacks booked by the AI" description="The caller's name and the day and time they chose (India time). The team confirms each with a meeting link." />
          <Table>
            <thead><tr><Th>Caller</Th><Th>When</Th><Th>Language</Th><Th>Status</Th><Th>Booked</Th></tr></thead>
            <tbody>{bookings.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium">{b.callerName}</Td>
                <Td>{new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(b.scheduledFor)}</Td>
                <Td>{b.language === "hi" ? "Hindi" : b.language === "hinglish" ? "Hinglish" : "English"}</Td>
                <Td><Badge tone={b.status === "cancelled" ? "neutral" : b.status === "done" ? "success" : "warning"}>{titleCase(b.status)}</Badge></Td>
                <Td className="text-muted-foreground">{formatDateTime(b.createdAt, lang)}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        </Card>
      )}
      <Card>
        <FilterBar
          action="/calls"
          q={sp.q}
          extra={<>{validDay && <input type="hidden" name="day" value={sp.day} />}{sp.analysis === "failed" && <input type="hidden" name="analysis" value="failed" />}</>}
          selects={[
            { name: "source", value: sp.source, label: "All sources", options: [["ai", "All AI calls"], ...CALL_SOURCES.map((s) => [s, SOURCE_LABEL[s]!] as [string, string])] },
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
                  <Td><Link className="text-primary hover:underline" href={`/calls/${c.id}`}>{formatDateTime(c.startedAt, lang)}</Link></Td>
                  <Td>{c.leadName ?? <span className="text-muted-foreground"><T>Unknown caller</T></span>}<div className="text-xs text-muted-foreground">{c.leadPhone}</div></Td>
                  <Td><div className="flex items-center gap-1.5"><SourceBadge source={c.source} />{c.handedOff && <Badge tone="warning">Handoff</Badge>}</div></Td>
                  <Td>{titleCase(c.direction)}</Td>
                  <Td><CallStatusBadge status={c.status} /></Td>
                  <Td className="tabular-nums">{c.durationS ? formatDuration(c.durationS) : "—"}</Td>
                  <Td>{c.agentEmail ?? <span className="text-muted-foreground"><T>AI</T></span>}</Td>
                  <Td><SentimentBadge label={c.sentimentLabel} /></Td>
                  <Td>{c.hasRecording ? <Mic className="h-4 w-4 text-muted-foreground" aria-label="Has recording" /> : <span className="text-muted-foreground">—</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager basePath="/calls" params={{ q: sp.q, source: sp.source, status: sp.status, day: validDay ? sp.day : undefined, analysis: sp.analysis === "failed" ? "failed" : undefined }} page={data.page} hasMore={data.hasMore} />
      </Card>
    </>
  );
}
