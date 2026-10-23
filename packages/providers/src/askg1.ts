import { ProviderError, type ChatMessage, type LlmAdapter } from "./types";

export interface AskG1Config {
  /** e.g. http://100.64.0.2:8080 (reachable only on the company VPN). */
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** How long to wait for AskG1 to start answering before giving up (an unreachable VPN host otherwise hangs). */
  responseTimeoutMs?: number;
  fetch?: typeof fetch;
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
        body: JSON.stringify({ model, messages, stream: true }),
        signal: ctl.signal,
      });
    } catch (err) {
      if (timedOut) throw new ProviderError("AskG1 did not answer in time", 504, "askg1");
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !res.body) throw new ProviderError(`AskG1 chat failed (${res.status})`, res.status, "askg1");

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
