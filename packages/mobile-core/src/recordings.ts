import type { DeviceCall } from "./types";

/** An audio file found on the phone (the call recorder's folder). */
export interface RecordingFile { uri: string; name: string; createdMs: number; sizeBytes: number }

/** How far from the call a recording's timestamp may be and still belong to it. Recorders stamp the start or the end of the call. */
export const BEFORE_MS = 90_000;
export const AFTER_MS = 180_000;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Pairs each call with at most one recording, and each recording with at most one call. A file matches a call when it was
 * created from shortly before the call started to shortly after it ended. When several fit, one whose name contains the
 * caller's last digits wins (Samsung names recordings after the number or contact), then the closest in time.
 * Files already uploaded (`done`) and files that are too big or empty are ignored.
 */
export function matchRecordings(calls: DeviceCall[], files: RecordingFile[], done: ReadonlySet<string> = new Set()): Array<{ localId: string; file: RecordingFile }> {
  const free = files.filter((f) => !done.has(f.uri) && f.sizeBytes > 0 && f.sizeBytes <= MAX_UPLOAD_BYTES);
  const used = new Set<string>(), out: Array<{ localId: string; file: RecordingFile }> = [];
  // Longest calls first: they are the ones that actually have a recording, so they should get first pick.
  for (const call of [...calls].filter((c) => c.status === "connected" && c.durationS > 0).sort((a, b) => b.durationS - a.durationS)) {
    const start = Date.parse(call.startedAt), end = start + call.durationS * 1000, tail = digits(call.number).slice(-8);
    const fits = free.filter((f) => !used.has(f.uri) && f.createdMs >= start - BEFORE_MS && f.createdMs <= end + AFTER_MS);
    if (!fits.length) continue;
    const score = (f: RecordingFile) => (tail.length >= 6 && digits(f.name).includes(tail) ? 0 : 1) * 1e12 + Math.min(Math.abs(f.createdMs - start), Math.abs(f.createdMs - end));
    const best = fits.reduce((a, b) => (score(b) < score(a) ? b : a));
    used.add(best.uri); out.push({ localId: call.localId, file: best });
  }
  return out;
}
