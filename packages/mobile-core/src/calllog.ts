import type { DeviceCall } from "./types";

/** One row from Android's call log (the fields the app reads; names follow react-native-call-log). */
export interface AndroidCallEntry {
  phoneNumber: string;
  /** Android's CallLog.Calls.TYPE: 1 incoming, 2 outgoing, 3 missed, 4 voicemail, 5 rejected, 6 blocked. */
  rawType: number;
  /** Milliseconds since 1970, as a string or number. */
  timestamp: string | number;
  duration: string | number;
  /** Which SIM took the call (CallLog.Calls.PHONE_ACCOUNT_ID). */
  phoneAccountId?: string;
}

export const MAX_BACKFILL_DAYS = 7;

/**
 * Turns one Android call-log row into a call to upload, or null when it must NOT be uploaded: the other SIM (personal calls
 * never leave the phone), voicemail, or a row we cannot read. `workAccountId` is the SIM the person chose as the work SIM.
 */
export function fromAndroid(e: AndroidCallEntry, workAccountId: string | null): DeviceCall | null {
  if (!workAccountId || e.phoneAccountId !== workAccountId) return null;
  const at = Number(e.timestamp), duration = Math.max(0, Math.round(Number(e.duration) || 0));
  if (!Number.isFinite(at) || at <= 0 || !e.phoneNumber) return null;
  const map: Record<number, Pick<DeviceCall, "direction" | "status"> | undefined> = {
    1: { direction: "inbound", status: duration > 0 ? "connected" : "missed" },
    2: { direction: "outbound", status: duration > 0 ? "connected" : "failed" },
    3: { direction: "inbound", status: "missed" },
    5: { direction: "inbound", status: "rejected" },
    6: { direction: "inbound", status: "rejected" },
  };
  const kind = map[e.rawType];
  if (!kind) return null;
  return { localId: `${at}-${e.phoneNumber.replace(/\W/g, "")}`.slice(0, 64), number: e.phoneNumber, ...kind, startedAt: new Date(at).toISOString(), durationS: duration };
}

/**
 * Which time to read the call log from: just after the last call already handled, but never further back than a week, so
 * installing the app does not upload someone's whole history.
 */
export function readFrom(lastHandledAt: number | null, now = Date.now()): number {
  const floor = now - MAX_BACKFILL_DAYS * 86_400_000;
  return Math.max(floor, (lastHandledAt ?? 0) + 1);
}

/** The newest call time among the rows, to remember as the cursor. */
export const newestTimestamp = (entries: AndroidCallEntry[]) => entries.reduce((m, e) => Math.max(m, Number(e.timestamp) || 0), 0);
