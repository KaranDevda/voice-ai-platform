import { NetworkError, UnpairedError, type Api } from "./api";
import type { DeviceCall, KeyValueStore } from "./types";

const KEY = "sync.queue.v1";
export const BATCH = 100;           // the server accepts up to 200 per request
export const MAX_QUEUE = 5000;      // a phone offline for weeks must not fill its storage; the oldest are dropped first

/** Seconds to wait before the next try after `failures` failed tries in a row: 5 s, 10 s, 20 s ... up to 15 minutes. */
export const backoffSeconds = (failures: number) => Math.min(900, 5 * 2 ** Math.max(0, failures - 1));

export interface FlushResult { sent: number; kept: number; state: "done" | "offline" | "unpaired"; nextTryInS?: number }

/**
 * The offline queue (SOP: offline queue, idempotent sync). Calls are written to storage first and removed only after the
 * server has answered for them, so a crash, a dropped connection or a closed app never loses a call. The server remembers
 * each call by its local id, so sending one twice is harmless.
 */
export class SyncQueue {
  private failures = 0;
  private running: Promise<FlushResult> | null = null;
  constructor(private store: KeyValueStore) {}

  async pending(): Promise<DeviceCall[]> {
    try { return JSON.parse((await this.store.get(KEY)) ?? "[]") as DeviceCall[]; } catch { return []; }
  }
  /** Forgets everything waiting to upload (when sharing is turned off, nothing from before may be sent later). */
  clear(): Promise<void> { return this.store.remove(KEY); }
  private save(calls: DeviceCall[]) { return this.store.set(KEY, JSON.stringify(calls.slice(-MAX_QUEUE))); }

  /** Adds calls, skipping any already waiting (the same call read twice from the call log). */
  async add(calls: DeviceCall[]): Promise<void> {
    if (!calls.length) return;
    const have = await this.pending();
    const ids = new Set(have.map((c) => c.localId));
    await this.save([...have, ...calls.filter((c) => !ids.has(c.localId) && ids.add(c.localId))]);
  }

  /** Sends everything waiting. Only one send runs at a time; a second request joins the first. */
  flush(api: Api): Promise<FlushResult> {
    return (this.running ??= this.run(api).finally(() => { this.running = null; }));
  }

  private async run(api: Api): Promise<FlushResult> {
    let sent = 0;
    for (;;) {
      const queue = await this.pending();
      if (!queue.length) { this.failures = 0; return { sent, kept: 0, state: "done" }; }
      const batch = queue.slice(0, BATCH);
      try {
        const results = await api.syncCalls(batch);
        const answered = new Set(results.map((r) => r.localId));
        // Whatever the server answered for (saved, duplicate or refused) is finished; anything it did not mention stays.
        const left = (await this.pending()).filter((c) => !answered.has(c.localId));
        await this.save(left);
        sent += results.filter((r) => r.result === "saved").length;
        if (answered.size === 0) return { sent, kept: left.length, state: "offline", nextTryInS: backoffSeconds(++this.failures) }; // no progress: do not spin
      } catch (e) {
        if (e instanceof UnpairedError) return { sent, kept: queue.length, state: "unpaired" };
        if (e instanceof NetworkError) return { sent, kept: queue.length, state: "offline", nextTryInS: backoffSeconds(++this.failures) };
        throw e;
      }
    }
  }
}
