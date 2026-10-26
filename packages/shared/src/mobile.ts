import { z } from "zod";
import { CALL_DIRECTIONS, CALL_STATUSES, DEVICE_PLATFORMS } from "./domain";

/** What the phone app sends to the server (SOP: Android and iOS apps, offline queue, idempotent sync). */
export const MOBILE_SYNC_MAX = 200;
export const PAIRING_CODE_TTL_MS = 10 * 60_000;

/** Codes avoid look-alike characters (0/O, 1/I/L), because a person types them from a screen. */
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const normalizePairingCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatPairingCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export const registerDeviceSchema = z.object({
  code: z.string().min(8).max(16),
  /** A stable random id the app creates once and keeps; pairing the same phone again updates it instead of adding a second one. */
  fingerprint: z.string().min(16).max(128),
  platform: z.enum(DEVICE_PLATFORMS),
  name: z.string().trim().min(1).max(60).optional(),
  appVersion: z.string().max(32).optional(),
  /** 0-based SIM slot the company calls use, so personal calls on the other SIM are never uploaded. */
  workSimSlot: z.number().int().min(0).max(3).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const deviceCallSchema = z.object({
  /** The app's own id for this call. With the device, it makes the upload safe to repeat. */
  localId: z.string().min(1).max(64),
  /** Private and short numbers do occur in a phone's call log; the server judges the number (see normalizePhone), so one never blocks a batch. */
  number: z.string().max(32),
  direction: z.enum(CALL_DIRECTIONS),
  status: z.enum(CALL_STATUSES),
  startedAt: z.string().datetime({ offset: true }),
  durationS: z.number().int().min(0).max(86_400),
});
export type DeviceCall = z.infer<typeof deviceCallSchema>;

/** The batch is checked call by call (see splitSyncBatch), never as a whole: one bad call must not stop the others, or the phone would retry the same batch forever. */
export const syncBatchSchema = z.object({ calls: z.array(z.unknown()).min(1).max(MOBILE_SYNC_MAX) });

/** Valid calls to save, and answers for the malformed ones (acknowledged so the app drops them). `at` keeps the original order. */
export function splitSyncBatch(items: unknown[]): { valid: Array<{ at: number; call: DeviceCall }>; invalid: Array<{ at: number; outcome: SyncOutcome }> } {
  const valid: Array<{ at: number; call: DeviceCall }> = [];
  const invalid: Array<{ at: number; outcome: SyncOutcome }> = [];
  items.forEach((item, at) => {
    const parsed = deviceCallSchema.safeParse(item);
    if (parsed.success) return void valid.push({ at, call: parsed.data });
    const id = (item as { localId?: unknown } | null)?.localId;
    invalid.push({ at, outcome: { localId: typeof id === "string" ? id.slice(0, 64) : `#${at}`, result: "rejected", reason: "invalid_call" } });
  });
  return { valid, invalid };
}

export const checkCallSchema = z
  .object({ leadId: z.string().uuid().optional(), number: z.string().min(3).max(32).optional() })
  .refine((v) => v.leadId || v.number, "leadId or number");

/** Per-call answer to a sync. Everything the server has dealt with is acknowledged (`saved`, `duplicate` or `rejected`), so the app can drop it from its queue. */
export type SyncOutcome = { localId: string; result: "saved" | "duplicate" | "rejected"; reason?: "invalid_number" | "invalid_call" | "from_the_future" };

/** The web dialer: a person calls from their own phone or computer, then logs how it went. */
export const logCallSchema = z.object({
  number: z.string().min(3).max(32),
  status: z.enum(CALL_STATUSES),
  durationS: z.number().int().min(0).max(86_400),
  startedAt: z.string().datetime({ offset: true }),
});
