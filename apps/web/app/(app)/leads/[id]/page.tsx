import { Bot, User } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeadDetail, listCalls } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Badge, CallStatusBadge, LeadStatusBadge, SentimentBadge, SourceBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDate, formatDateTime, formatDuration } from "@/lib/utils";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser();
  const detail = await allowed(async () => getLeadDetail(getDb(), user, id));
  if (detail === null) return <Forbidden />;
  if (!detail) notFound();
  const calls = await allowed(() => listCalls(getDb(), user, { leadId: id }, 10));
  const { lead, ownerEmail, history } = detail;

  const rows: Array<[string, React.ReactNode]> = [
    ["Phone", lead.phoneE164], ["Email", lead.email ?? "—"], ["Source", lead.source ?? "—"], ["Owner", ownerEmail ?? "Unassigned"],
    ["Score", lead.score ?? "—"], ["Created", formatDate(lead.createdAt)],
    ["Call consent", lead.consentStatus], ["Do not disturb", lead.dndFlag ? <Badge tone="danger">Yes, do not call</Badge> : "No"],
  ];

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/leads" className="text-muted-foreground hover:text-foreground">← Leads</Link></p>
      <PageHeader title={lead.name ?? "Unknown caller"} description={lead.phoneE164} actions={<LeadStatusBadge status={lead.status} />} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Call history" description="Newest first" />
            {!calls || calls.rows.length === 0 ? (
              <EmptyState title="No calls yet" />
            ) : (
              <Table>
                <thead><tr><Th>When</Th><Th>Source</Th><Th>Status</Th><Th>Duration</Th><Th>Agent</Th><Th>Sentiment</Th></tr></thead>
                <tbody>
                  {calls.rows.map((c) => (
                    <Tr key={c.id}>
                      <Td><Link className="text-primary hover:underline" href={`/calls/${c.id}`}>{formatDateTime(c.startedAt)}</Link></Td>
                      <Td><SourceBadge source={c.source} /></Td>
                      <Td><CallStatusBadge status={c.status} /></Td>
                      <Td className="tabular-nums">{c.durationS ? formatDuration(c.durationS) : "—"}</Td>
                      <Td>{c.agentEmail ?? <span className="text-muted-foreground">AI</span>}</Td>
                      <Td><SentimentBadge label={c.sentimentLabel} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Status history" description="Every pipeline move, with who or what made it" />
            <CardBody>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No status changes yet.</p>
              ) : (
                <ol className="grid gap-4">
                  {history.map((h) => (
                    <li key={h.id} className="flex gap-3">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                        {h.by === "ai" ? <Bot className="h-4 w-4" aria-label="AI" /> : <User className="h-4 w-4" aria-label="User" />}
                      </span>
                      <div className="text-sm">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {h.from ? <LeadStatusBadge status={h.from} /> : null}<span className="text-muted-foreground">→</span><LeadStatusBadge status={h.to} />
                          {h.confidence !== null && <Badge tone="info">{Math.round(h.confidence * 100)}% confidence</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {h.by === "ai" ? "AI" : h.byEmail ?? "User"} · {formatDateTime(h.at)}{h.reason ? ` · ${h.reason}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <Card className="content-start">
          <CardHeader title="Details" />
          <dl className="grid divide-y divide-border text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <dt className="text-muted-foreground">Tags</dt>
              <dd className="flex flex-wrap gap-1">{lead.tags.length ? lead.tags.map((t) => <Badge key={t}>{t}</Badge>) : "—"}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}
