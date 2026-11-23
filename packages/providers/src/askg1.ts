import { ProviderError, type ChatMessage, type LlmAdapter } from "./types";

export interface AskG1Config {
  /** Caps the length of a reply. Spoken answers should be short. */
  maxTokens?: number;
  /** Lower is more focused and repeatable. */
  temperature?: number;
  /** e.g. http://100.64.0.2:8080 (reachable only on the company VPN). */
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** How long to wait for AskG1 to start answering before giving up (an unreachable VPN host otherwise hangs). */
  responseTimeoutMs?: number;
  fetch?: typeof fetch;
}

/** The real reason a fetch failed: Node puts it in error.cause (code + message), not in "fetch failed". */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const c = (err as { cause?: { code?: string; message?: string; errors?: Array<{ code?: string }> } }).cause;
  if (!c) return err.message;
  const code = c.code ?? c.errors?.[0]?.code;
  return [err.message, code, c.message && c.message !== err.message ? c.message : ""].filter(Boolean).join(" / ");
}

/**
 * AskG1 adapter. ASSUMPTION, not yet verified against the real service: it speaks the OpenAI-compatible
 * chat-completions protocol (`POST {baseUrl}/v1/chat/completions`, bearer auth, SSE `data:` chunks).
 * Confirm against AskG1's API docs once the VPN is connected and adjust `chat()` if it differs.
 */
export function createAskG1(config: AskG1Config): LlmAdapter {
  const base = config.baseUrl.replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;
  const model = config.model ?? "g1-chat";

  async function* chat({ messages, signal }: { messages: ChatMessage[]; signal?: AbortSignal }): AsyncGenerator<string> {
    // Abort if no response starts in time, or if the caller aborts (barge-in, closed tab).
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, config.responseTimeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await doFetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ model, messages, stream: true, ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}), ...(config.temperature !== undefined ? { temperature: config.temperature } : {}) }),
        signal: ctl.signal,
      });
    } catch (err) {
      if (timedOut) throw new ProviderError(`AskG1 did not answer in time (${base})`, 504, "askg1");
      if (signal?.aborted) throw err;
      // Node's bare "fetch failed" hides the real reason in error.cause (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, a TLS error...).
      throw new ProviderError(`AskG1 request to ${base}/v1/chat/completions failed: ${describeFetchError(err)}`, 502, "askg1");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new ProviderError(`AskG1 chat failed (${res.status}) at ${base}: ${body.replace(/\s+/g, " ").slice(0, 200)}`, res.status, "askg1");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const token = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch {
            // Ignore keep-alive or non-JSON lines.
          }
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await reader.cancel().catch(() => {});
    }
  }

  return {
    chat,
    respond({ transcript, leadContext, knowledge, signal }) {
      const system = [
        "You are a phone assistant. Answer briefly and only from the knowledge provided.",
        knowledge.length ? `Knowledge:\n${knowledge.join("\n---\n")}` : "",
        Object.keys(leadContext).length ? `Caller context: ${JSON.stringify(leadContext)}` : "",
      ].filter(Boolean).join("\n\n");
      return chat({ messages: [{ role: "system", content: system }, { role: "user", content: transcript }], signal });
    },
  };
}
