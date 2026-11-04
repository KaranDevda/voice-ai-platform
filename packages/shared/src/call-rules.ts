/**
 * The rules an outbound call must pass before it is placed (SOP: DND check before every outbound call, calling window
 * 9:00 to 21:00 IST). One place, so the dialer screen and the voice service can never disagree.
 */
export type CallBlockReason = "dnd" | "consent_withdrawn" | "consent_denied" | "outside_hours" | "unknown_lead" | "no_credit";

export interface CallRuleLead { dndFlag: boolean; consentStatus: "unknown" | "granted" | "denied" | "withdrawn" }
export interface CallingWindow { windowStart: string; windowEnd: string }

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Minutes since midnight in India, where TRAI's calling hours apply, whatever time zone the server is in. */
export function istMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

export const inCallingWindow = (now: Date, w: CallingWindow) => {
  const t = istMinutes(now);
  return t >= minutesOf(w.windowStart) && t < minutesOf(w.windowEnd);
};

/** Why this call must not be placed, or null when it may be. The first reason found is returned, most serious first. */
export function callBlockReason(lead: CallRuleLead, window: CallingWindow, now: Date): CallBlockReason | null {
  if (lead.dndFlag) return "dnd";
  if (lead.consentStatus === "withdrawn") return "consent_withdrawn";
  if (lead.consentStatus === "denied") return "consent_denied";
  if (!inCallingWindow(now, window)) return "outside_hours";
  return null;
}

export const CALL_BLOCK_MESSAGES: Record<CallBlockReason, string> = {
  dnd: "This number is on Do Not Disturb, so it cannot be called.",
  consent_withdrawn: "This person withdrew consent, so they cannot be called.",
  consent_denied: "This person did not consent to be called.",
  outside_hours: "Calls are only allowed during the calling window (India time).",
  unknown_lead: "That lead does not exist, so it cannot be called.",
  no_credit: "There is no credit left. Add credit on the Billing page to make calls.",
};
