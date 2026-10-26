import type { ChatMessage, LlmAdapter } from "@voiceai/providers";

export interface FailoverOptions {
  /** How long the main model gets to produce its first word before the backup answers instead. */
  firstTokenTimeoutMs?: number;
  /** After the main model fails, how long to go straight to the backup (so each turn does not wait to fail again). */
  coolDownMs?: number;
  /** Called each time a turn is answered by the backup, with why the main model was skipped. */
  onBackup?: (why: string) => void;
  now?: () => number;
}

/**
 * The main model (AskG1) with a backup (a small local model). If the main model cannot be reached, errors, or says nothing
 * within the time allowed, the backup answers that turn. Once the main model has started answering it is never swapped
 * mid-reply, because the caller would hear two different answers stitched together.
 */
export function withFailover(main: LlmAdapter, backup: LlmAdapter, o: FailoverOptions = {}): LlmAdapter {
  const timeoutMs = o.firstTokenTimeoutMs ?? 8000, coolMs = o.coolDownMs ?? 120_000, now = o.now ?? Date.now;
  let downUntil = 0;

  async function* chat(input: { messages: ChatMessage[]; signal?: AbortSignal }): AsyncGenerator<string> {
    let why = "it failed a moment ago";
    if (now() >= downUntil) {
      const ac = new AbortController();
      const relay = () => ac.abort();
      input.signal?.addEventListener("abort", relay, { once: true });
      const it = main.chat({ ...input, signal: ac.signal })[Symbol.asyncIterator]();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let spoke = false;
      try {
        const first = await Promise.race([
          it.next(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs / 1000} s`)), timeoutMs); }),
        ]);
        clearTimeout(timer);
        if (!first.done) {
          spoke = true;
          yield first.value;
          for (let n = await it.next(); !n.done; n = await it.next()) yield n.value;
          return;
        }
        why = "it returned nothing";
      } catch (e) {
        if (input.signal?.aborted || spoke) { if (input.signal?.aborted) return; throw e; }
        why = e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", relay);
        ac.abort();
      }
      downUntil = now() + coolMs;
    }
    o.onBackup?.(why);
    let spoke = false;
    try {
      for await (const t of backup.chat(input)) { spoke = true; yield t; }
    } catch (e) {
      if (spoke || input.signal?.aborted) throw e;
      // Both failed: say so in words, instead of the bare "fetch failed" the network layer gives.
      throw new Error(`The AI could not be reached: AskG1 (${why}) and the backup model (${e instanceof Error ? e.message : String(e)}). Start the backup with pnpm dev:stack, or connect to the AskG1 VPN.`);
    }
  }

  return { chat, respond: (i) => main.respond(i) };
}
