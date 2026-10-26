import CallLogs from "react-native-call-log";
import { PermissionsAndroid, Platform } from "react-native";
import { fromAndroid, newestTimestamp, readFrom, type AndroidCallEntry, type DeviceCall, type SyncQueue } from "../../../packages/mobile-core/src";
import { store } from "./session";

const WORK_SIM = "workSim.v1";
const CURSOR = "callLogCursor.v1";

export interface SimChoice { id: string; label: string }

export async function hasPermission(): Promise<boolean> {
  return Platform.OS === "android" && (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG));
}
export async function askPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const r = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.READ_CALL_LOG, PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE]);
  return r[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] === "granted";
}

export const getWorkSim = () => store.get(WORK_SIM);
export async function setWorkSim(id: string | null) {
  if (id) await store.set(WORK_SIM, id); else await store.remove(WORK_SIM);
  await store.remove(CURSOR); // the history to read from depends on which SIM is the work SIM
}

/** The SIMs that appear in the recent call log, so the person can say which one is for work. Only labels are shown, never numbers. */
export async function simsSeen(): Promise<SimChoice[]> {
  const rows = (await CallLogs.load(200, { minTimestamp: readFrom(null) })) as unknown as Array<AndroidCallEntry & { simDisplayName?: string | null }>;
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.phoneAccountId && !seen.has(r.phoneAccountId)) seen.set(r.phoneAccountId, r.simDisplayName || `SIM ${seen.size + 1}`);
  }
  return [...seen].map(([id, label]) => ({ id, label }));
}

/** Reads the work SIM's new calls into the offline queue. Personal-SIM calls are filtered out here and never leave the phone. */
export async function collectNewCalls(queue: SyncQueue): Promise<number> {
  const sim = await getWorkSim();
  if (!sim || !(await hasPermission())) return 0;
  const cursor = Number(await store.get(CURSOR)) || null;
  const rows = (await CallLogs.load(-1, { minTimestamp: readFrom(cursor) })) as unknown as AndroidCallEntry[];
  const calls = rows.map((r) => fromAndroid(r, sim)).filter((c): c is DeviceCall => c !== null);
  await queue.add(calls); // written to storage before the cursor moves, so a crash here re-reads instead of losing
  const newest = newestTimestamp(rows);
  if (newest) await store.set(CURSOR, String(newest));
  return calls.length;
}
