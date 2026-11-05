import { z } from "zod";
import type { LeadStatus } from "./domain";
import { LEAD_STATUSES } from "./domain";

/** SOP: a status suggested by the AI is applied by itself only at this confidence or higher; below it, the owner is asked. */
export const AUTO_APPLY_MIN_CONFIDENCE = 0.8;

/**
 * Statuses the AI may set by itself. "won" and "lost" end a lead's story, and people must decide those: a caller can say anything on a
 * call (including "mark me as won"), so the AI never closes a lead on its own.
 */
export const AI_SETTABLE: ReadonlySet<LeadStatus> = new Set<LeadStatus>(["new", "contacted", "interested", "callback_requested", "not_interested"]);

export type StatusDecision = "apply" | "queue" | "none";

/** What to do with the status the AI suggested: change it now, leave it for the owner to confirm, or nothing. */
export function decideStatusChange(o: { current: LeadStatus; suggested: LeadStatus | null; confidence: number | null }): StatusDecision {
  if (!o.suggested || o.suggested === o.current) return "none";
  if (o.current === "won" || o.current === "lost") return "queue"; // a closed lead is never reopened by the AI
  if (!AI_SETTABLE.has(o.suggested)) return "queue";
  return (o.confidence ?? 0) >= AUTO_APPLY_MIN_CONFIDENCE ? "apply" : "queue";
}

/** What the model must answer with. Everything is checked: the model's output is data, never instructions. */
const raw = z.object({
  summary: z.string().trim().min(1),
  intent: z.string().trim().optional().nullable(),
  sentiment_score: z.coerce.number().optional(),
  sentiment: z.string().optional().nullable(),
  next_action: z.string().trim().optional().nullable(),
  suggested_status: z.string().optional().nullable(),
  confidence: z.coerce.number().optional().nullable(),
  do_not_call: z.union([z.boolean(), z.string()]).optional().nullable(),
});

export interface CallAnalysis {
  summary: string;
  intent: string | null;
  sentimentScore: number;
  sentimentLabel: "positive" | "neutral" | "negative";
  nextAction: string | null;
  suggestedStatus: LeadStatus | null;
  confidence: number | null;
  /** The caller clearly asked not to be called again. */
  doNotCall: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The first complete {...} object in the text (models sometimes wrap it in words or a code fence). */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Fixes a stray quote after a number in the two numeric fields, and a trailing comma. Nothing else is touched. */
export function repairJson(json: string): string {
  return json.replace(/("(?:sentiment_score|confidence)"\s*:\s*-?\d+(?:\.\d+)?)"/g, "$1").replace(/,(\s*[}\]])/g, "$1");
}

/** The model's answer as a safe, complete analysis, or null when it cannot be used (the caller then retries later). */
export function parseAnalysis(text: string): CallAnalysis | null {
  // The extractor counts quotes, so a stray one hides the whole object: look again after repairing.
  const json = extractJsonObject(text) ?? extractJsonObject(repairJson(text));
  if (!json) return null;
  let parsed: z.infer<typeof raw>;
  try { const r = raw.safeParse(JSON.parse(json)); if (!r.success) return null; parsed = r.data; } catch {
    // Small models slip now and then ("confidence": 0", or a comma before the closing brace). At temperature 0 asking again gives the same slip,
    // so a call could never be analysed: repair those two slips, only for invalid JSON, and still require the full shape.
    try { const r = raw.safeParse(JSON.parse(repairJson(json))); if (!r.success) return null; parsed = r.data; } catch { return null; }
  }
  const score = clamp(Number.isFinite(parsed.sentiment_score) ? parsed.sentiment_score! : 0, -1, 1);
  const word = (parsed.sentiment ?? "").toLowerCase();
  // The words and the number must agree: when the model's word contradicts its number, the number decides.
  const label = score > 0.25 ? "positive" : score < -0.25 ? "negative" : word === "positive" || word === "negative" ? (Math.abs(score) < 0.1 ? "neutral" : word) : "neutral";
  const status = (LEAD_STATUSES as readonly string[]).includes((parsed.suggested_status ?? "").toLowerCase().replace(/[\s-]+/g, "_")) ? ((parsed.suggested_status ?? "").toLowerCase().replace(/[\s-]+/g, "_") as LeadStatus) : null;
  const conf = parsed.confidence == null || !Number.isFinite(parsed.confidence) ? null : clamp(parsed.confidence, 0, 1);
  const dnc = parsed.do_not_call === true || (typeof parsed.do_not_call === "string" && /^(true|yes)$/i.test(parsed.do_not_call.trim()));
  return {
    summary: parsed.summary.slice(0, 600),
    intent: parsed.intent ? parsed.intent.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || null : null,
    sentimentScore: Math.round(score * 100) / 100,
    sentimentLabel: label as CallAnalysis["sentimentLabel"],
    nextAction: parsed.next_action ? parsed.next_action.slice(0, 300) : null,
    suggestedStatus: status,
    confidence: status ? conf : null,
    doNotCall: dnc,
  };
}
