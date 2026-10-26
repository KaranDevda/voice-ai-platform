/** The phone app's view of the server API. Plain types only: this package runs inside React Native, so it imports nothing heavy.
 * A test checks these against the server's own schemas (packages/shared/src/mobile.ts) so the two cannot drift apart. */
export interface DeviceCall {
  localId: string;
  number: string;
  direction: "inbound" | "outbound";
  status: "connected" | "missed" | "rejected" | "failed";
  startedAt: string;
  durationS: number;
}
export interface SyncOutcome { localId: string; result: "saved" | "duplicate" | "rejected"; reason?: string }
export interface LeadOption { id: string; name: string | null; phone: string; dnd: boolean }
export type CheckResult = { allowed: true } | { allowed: false; reason: string; message: string };
export interface Pairing { baseUrl: string; token: string; deviceId: string; email: string }

/** Where the app keeps small pieces of data between launches (AsyncStorage on the phone, a Map in tests). */
export interface KeyValueStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
