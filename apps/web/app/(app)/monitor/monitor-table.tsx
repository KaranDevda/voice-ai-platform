"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, CallStatusBadge, SentimentBadge, SourceBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime, formatDuration, titleCase } from "@/lib/utils";

interface CallRow {
  id: string;
  startedAt: string;
  direction: string;
  source: string;
  status: string;
  durationS: number | null;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  agentEmail: string | null;
  sentimentLabel: string | null;
  handedOff: boolean;
  transcript:
    | {
        segments: Array<{
          speaker: string;
          startMs: number;
          endMs: number;
          text: string;
          interrupted?: boolean;
        }>;
        language: string | null;
      }
    | null;
}

function Segment({ s }: { s: { speaker: string; startMs: number; endMs: number; text: string; interrupted?: boolean } }) {
  const who = s.speaker === "ai" ? "AI" : s.speaker === "caller" ? "Caller" : "Agent";
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-10 shrink-0 text-xs text-muted-foreground">{who}</span>
      <span className="text-xs text-muted-foreground">[{Math.floor(s.startMs / 1000)}s]</span>
      <span className={s.interrupted ? "font-medium text-destructive" : ""}>{s.text}</span>
    </div>
  );
}

function MonitorRow({ c, open, setOpen }: { c: CallRow; open: Set<string>; setOpen: (s: Set<string>) => void }) {
  const isOpen = open.has(c.id);
  const segments = c.transcript?.segments ?? [];
  const toggle = () => {
    const next = new Set(open);
    if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
    setOpen(next);
  };
  return (
    <Tr key={c.id} className={isOpen ? "bg-muted/50" : ""} onClick={toggle}>
      <Td>
        <Link className="text-primary hover:underline" href={`/calls/${c.id}`}>
          {formatDateTime(c.startedAt)}
        </Link>
      </Td>
      <Td>
        {c.leadName ?? <span className="text-muted-foreground">Unknown caller</span>}
        <div className="text-xs text-muted-foreground">{c.leadPhone}</div>
      </Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <SourceBadge source={c.source} />
          {c.handedOff && <Badge tone="warning">Handoff</Badge>}
        </div>
      </Td>
      <Td>{titleCase(c.direction)}</Td>
      <Td><CallStatusBadge status={c.status} /></Td>
      <Td className="tabular-nums">{c.durationS ? formatDuration(c.durationS) : "—"}</Td>
      <Td>{c.agentEmail ?? <span className="text-muted-foreground">AI</span>}</Td>
      <Td><SentimentBadge label={c.sentimentLabel} /></Td>
      <Td className="text-end">
        <Button size="sm" variant="outline" onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}>
          {isOpen ? "Hide transcript" : "Transcript"}
        </Button>
      </Td>
      {isOpen && (
        <Td colSpan={999}>
          <div className="pt-2 border-t border-border rounded-b-lg bg-muted/50">
            {segments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No transcript saved yet.</p>
            ) : (
              segments.map((s) => <Segment key={`${c.id}-${s.startMs}`} s={s} />)
            )}
          </div>
        </Td>
      )}
    </Tr>
  );
}

export function MonitorTable({ rows, aggregateOnly }: { rows: CallRow[]; aggregateOnly: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const router = useRouter();

  if (aggregateOnly) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">You have a summary-only view. Individual calls are not shown for your role.</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No calls yet. Start a live conversation, place a call from the dialer, or wait for a carrier call.
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void router.refresh()}>Refresh</Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Lead</Th>
            <Th>Source</Th>
            <Th>Direction</Th>
            <Th>Outcome</Th>
            <Th>Duration</Th>
            <Th>Agent</Th>
            <Th>Sentiment</Th>
            <Th className="text-end">Transcript</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => <MonitorRow key={c.id} c={c} open={open} setOpen={setOpen} />)}
        </tbody>
      </Table>
    </div>
  </div>
  );
}
