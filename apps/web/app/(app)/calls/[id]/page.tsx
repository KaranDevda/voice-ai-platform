import { Bot, Headphones, Lightbulb, User, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCallDetail } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Badge, CallStatusBadge, LeadStatusBadge, SentimentBadge, SourceBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page";
import { PostButton } from "@/components/post-button";
import { WaveformPlayer } from "@/components/waveform-player";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { cn, formatDateTime, formatDuration, titleCase } from "@/lib/utils";

const UUID = /^[0-9a-f-]{36}$/i;
const SPEAKER = {
  ai: { label: "AI assistant", icon: Bot, bubble: "bg-primary-soft", align: "" },
  agent: { label: "Agent", icon: UserRound, bubble: "bg-info-soft", align: "" },
  caller: { label: "Caller", icon: User, bubble: "bg-muted", align: "md:ms-16" },
} as const;
const mmss = (ms: number) => formatDuration(ms / 1000);

export default async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser();
  const detail = await allowed(async () => getCallDetail(getDb(), user, id));
  if (detail === null) return <Forbidden />;
  if (!detail) notFound();
  const { call, canPlay, canTranscript, transcript, insight, statusInfo, analysisPending, analysisFailed, analysisRerunQueued, canRerun } = detail;

  const meta: Array<[string, React.ReactNode]> = [
    ["Source", <SourceBadge key="s" source={call.source} />], ["Outcome", <CallStatusBadge key="o" status={call.status} />],
    ["Direction", titleCase(call.direction)], ["Duration", call.durationS ? formatDuration(call.durationS) : "—"],
    ["Agent", call.agentEmail ?? "AI assistant"], ["AI voice", call.voiceLabel ?? "—"],
  ];

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/calls" className="text-muted-foreground hover:text-foreground">← Call logs</Link></p>
      <PageHeader
        title={`Call with ${call.leadName ?? "unknown caller"}`}
        description={`${formatDateTime(call.startedAt)}${call.leadPhone ? ` · ${call.leadPhone}` : ""}`}
        actions={call.leadId ? <Link href={`/leads/${call.leadId}`} className="text-sm text-primary hover:underline">View lead</Link> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Recording" description="Plays are logged to the audit trail" />
            <CardBody>
              {canPlay ? (
                <WaveformPlayer lazy src={`/api/calls/${call.id}/recording`} />
              ) : (
                <div className="flex items-center gap-3 text-sm text-muted-foreground"><Headphones className="h-5 w-5" aria-hidden />No recording available to you for this call.</div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Transcript" />
            {!canTranscript ? (
              <EmptyState title="Transcript not available to your role" />
            ) : !transcript ? (
              <EmptyState title="No transcript" description="Short, unanswered or unrecorded calls have no transcript." />
            ) : (
              <CardBody className="grid gap-3">
                {transcript.segments.map((s, i) => {
                  const sp = SPEAKER[s.speaker];
                  const Icon = sp.icon;
                  return (
                    <div key={i} className={cn("flex gap-3", sp.align)}>
                      <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Icon className="h-4 w-4" aria-hidden /></span>
                      <div className={cn("rounded-xl px-4 py-2.5 text-sm", sp.bubble)}>
                        <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium">{sp.label}</span><span className="tabular-nums">{mmss(s.startMs)}</span>
                          {s.interrupted && <Badge tone="warning">Interrupted by caller</Badge>}
                        </div>
                        {s.text}
                      </div>
                    </div>
                  );
                })}
              </CardBody>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Call details" />
            <dl className="grid divide-y divide-border text-sm">
              {meta.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
              {call.handedOff && <div className="px-5 py-3"><Badge tone="warning">Transferred to a human agent</Badge></div>}
            </dl>
          </Card>

          <Card>
            <CardHeader title="AI insights" />
            {!insight ? (
              <div>
                <EmptyState title={analysisFailed ? "The AI could not analyse this call" : analysisPending ? "Being analysed" : "No insights yet"}
                  description={analysisFailed ? `It tried ${analysisFailed.attempts} times and gave up${analysisFailed.error ? `: ${analysisFailed.error}` : "."}` : analysisPending ? "The summary, sentiment and next step appear within a minute. Reload this page." : "Insights appear after the call is transcribed."} />
                {canRerun && (analysisFailed || analysisPending) && <div className="flex justify-center pb-6"><PostButton url={`/api/calls/${id}/analysis`} size="sm" variant="soft">{analysisFailed ? "Try again" : "Analyse now"}</PostButton></div>}
              </div>
            ) : (
              <CardBody className="grid gap-4 text-sm">
                <p>{insight.summary}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <SentimentBadge label={insight.sentimentLabel} />
                  <span className="tabular-nums text-muted-foreground">score {insight.sentimentScore.toFixed(2)}</span>
                  {insight.intent && <Badge tone="info">{titleCase(insight.intent)}</Badge>}
                </div>
                {insight.nextAction && (
                  <div className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-warning"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><b>Next:</b> {insight.nextAction}</span></div>
                )}
                {insight.suggestedStatus && (
                  <div className="grid gap-2 rounded-lg border border-border px-3 py-2.5 text-xs">
                    <div className="text-muted-foreground">
                      Suggested status <LeadStatusBadge status={insight.suggestedStatus} /> at {Math.round((insight.suggestedStatusConfidence ?? 0) * 100)}% confidence
                    </div>
                    {!statusInfo ? null : statusInfo.current === insight.suggestedStatus ? (
                      <div className="text-foreground">{statusInfo.by === "ai" ? "Applied automatically: the lead is now " : statusInfo.by === "user" ? "Confirmed by a person: the lead is now " : "The lead is already "}<LeadStatusBadge status={statusInfo.current} /></div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground">{(insight.suggestedStatusConfidence ?? 0) < 0.5 ? <>Not applied: the AI was not sure enough to offer this. The lead stays <LeadStatusBadge status={statusInfo.current} />.</> : <>Not applied automatically (the lead is <LeadStatusBadge status={statusInfo.current} />): it needs the owner to confirm.</>}</span>
                        {statusInfo.canConfirm && (insight.suggestedStatusConfidence ?? 0) >= 0.5 && <PostButton url={`/api/calls/${id}/insight`} size="sm" variant="soft" confirm={`Change this lead's status to ${titleCase(insight.suggestedStatus)}?`}>Confirm {titleCase(insight.suggestedStatus)}</PostButton>}
                      </div>
                    )}
                  </div>
                )}
                {canRerun && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                    {analysisRerunQueued ? <span>A fresh analysis is on its way. Reload in a minute.</span> : <>
                      <PostButton url={`/api/calls/${id}/analysis`} size="sm" variant="outline">Re-run analysis</PostButton>
                      <span>Gives a fresh summary. The lead's status is not changed again.</span></>}
                  </div>
                )}
                {!insight.suggestedStatus && insight.sentimentLabel === "negative" && (
                  <div className="text-xs text-muted-foreground">Negative sentiment never closes a lead on its own, so it is flagged for manager review.</div>
                )}
              </CardBody>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
