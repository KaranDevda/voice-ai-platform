import { ProviderError, type SttAdapter, type SttEvent, type SttSession } from "./types";

export interface DeepgramLiveConfig {
  apiKey: string;
  /** Silence that ends a turn. Shorter is faster but cuts off people who pause mid-sentence. */
  endpointingMs?: number;
  baseUrl?: string;
  model?: string;
  /**
   * Deepgram usually flags the end of a turn (`speech_final`), but sometimes finished words arrive without it.
   * If finished words wait this long with no flag and no new speech, they are sent anyway.
   */
  flushAfterMs?: number;
}

const LANGUAGE = { en: "en", hi: "hi", "en-hi": "multi" } as const;

interface DgMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
}

/**
 * Live speech-to-text over Deepgram's WebSocket. Emits partial transcripts as the caller speaks, a `final` once per
 * finished turn (all finalised pieces joined), and `speech_started` the moment voice is detected, which drives barge-in.
 */
export function createDeepgramLive(config: DeepgramLiveConfig): SttAdapter {
  const base = (config.baseUrl ?? "wss://api.deepgram.com").replace(/\/$/, "");
  return {
    async open({ language, encoding = "linear16", sampleRate = 16_000 }): Promise<SttSession> {
      const q = new URLSearchParams({
        model: config.model ?? "nova-3", language: LANGUAGE[language], encoding, sample_rate: String(sampleRate), channels: "1",
        interim_results: "true", endpointing: String(config.endpointingMs ?? 300), vad_events: "true", smart_format: "true",
        utterance_end_ms: "1000",
      });
      const ws = new WebSocket(`${base}/v1/listen?${q}`, ["token", config.apiKey]);
      ws.binaryType = "arraybuffer";

      const queue: SttEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const push = (e: SttEvent) => { queue.push(e); wake?.(); wake = null; };
      let pending: string[] = [];
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const clearFlush = () => { if (flushTimer) clearTimeout(flushTimer); flushTimer = null; };
      const flush = () => {
        clearFlush();
        const full = pending.join(" ").trim();
        pending = [];
        if (full) push({ kind: "final", text: full, language });
      };

      ws.onmessage = (m) => {
        if (typeof m.data !== "string") return;
        const d = JSON.parse(m.data) as DgMessage;
        if (d.type === "SpeechStarted") return push({ kind: "speech_started" });
        if (d.type === "UtteranceEnd") { flush(); return push({ kind: "end_of_speech" }); }
        if (d.type !== "Results") return;
        const text = d.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (d.is_final && text) pending.push(text);
        if (d.speech_final) return flush();
        if (text) {
          push({ kind: "partial", text: [...pending, ...(d.is_final ? [] : [text])].join(" ").trim() });
          // New words still arriving: wait. Finished words with nothing following: start the safety timer.
          clearFlush();
          if (d.is_final && pending.length) flushTimer = setTimeout(flush, config.flushAfterMs ?? 800);
        }
      };
      const end = () => { clearFlush(); closed = true; wake?.(); wake = null; };
      ws.onclose = end;
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new ProviderError("Deepgram live connection failed", 502, "deepgram"));
      });
      ws.onerror = end;

      // Deepgram closes idle sockets after ~10 s without audio; a keep-alive covers pauses.
      const keepAlive = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "KeepAlive" })); }, 5000);

      return {
        send: (frame) => { if (ws.readyState === 1) ws.send(frame as unknown as ArrayBuffer); },
        async close() {
          clearInterval(keepAlive);
          clearFlush();
          if (ws.readyState === 1) { ws.send(JSON.stringify({ type: "CloseStream" })); ws.close(); }
          end();
        },
        events: {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              while (queue.length) yield queue.shift()!;
              if (closed) return;
              await new Promise<void>((r) => { wake = r; });
            }
          },
        },
      };
    },
  };
}
