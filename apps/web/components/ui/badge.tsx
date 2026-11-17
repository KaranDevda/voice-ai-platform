import type { ReactNode } from "react";
import { cn, titleCase } from "@/lib/utils";
import { T } from "../t";

const tones = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}><T>{children}</T></span>;
}

const LEAD_TONE: Record<string, Tone> = {
  new: "info", contacted: "neutral", interested: "success", callback_requested: "warning", not_interested: "danger", won: "success", lost: "danger",
};
export const LeadStatusBadge = ({ status }: { status: string }) => <Badge tone={LEAD_TONE[status] ?? "neutral"}>{titleCase(status)}</Badge>;

const CALL_TONE: Record<string, Tone> = { connected: "success", missed: "warning", rejected: "danger", failed: "danger" };
export const CallStatusBadge = ({ status }: { status: string }) => <Badge tone={CALL_TONE[status] ?? "neutral"}>{titleCase(status)}</Badge>;

const SOURCE_LABEL: Record<string, string> = { ai_inbound: "AI inbound", ai_outbound: "AI outbound", web_dialer: "Web dialer", mobile_sim: "Mobile SIM" };
export const SourceBadge = ({ source }: { source: string }) => (
  <Badge tone={source.startsWith("ai_") ? "primary" : "neutral"}>{SOURCE_LABEL[source] ?? source}</Badge>
);

export const SentimentBadge = ({ label }: { label?: string | null }) =>
  label ? <Badge tone={label === "positive" ? "success" : label === "negative" ? "danger" : "neutral"}>{titleCase(label)}</Badge> : <span className="text-muted-foreground">—</span>;
