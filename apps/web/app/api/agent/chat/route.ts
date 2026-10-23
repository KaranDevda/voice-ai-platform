import { z } from "zod";
import { getAgentConfig, logUsage, searchKnowledge } from "@voiceai/db";
import { getLlm } from "@/lib/providers";
import { getDb } from "@/lib/server";
import { studioRoute } from "@/lib/studio-route";

const body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).min(1).max(40),
  useKnowledge: z.boolean().default(true),
});

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Streams the AI agent's reply as server-sent events: `meta` (sources), `token`*, then `done` or `error`. */
export const POST = (req: Request) =>
  studioRoute({ mutation: true }, async (user) => {
    const input = body.parse(await req.json().catch(() => null));
    const llm = getLlm();
    const cfg = await getAgentConfig(getDb(), user);
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const sources = input.useKnowledge ? await searchKnowledge(getDb(), user, lastUser) : [];

    const system = [
      cfg.systemPrompt,
      sources.length ? `Answer using only this knowledge. If it does not contain the answer, say you do not know and offer a human.\n\n${sources.map((s, i) => `[${i + 1}] ${s.title}: ${s.content}`).join("\n\n")}` : "",
    ].filter(Boolean).join("\n\n");

    const t0 = Date.now();
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => controller.enqueue(enc.encode(sse(event, data)));
        let first: number | null = null;
        let chars = 0;
        try {
          send("meta", { sources: sources.map((s) => ({ title: s.title, snippet: s.content.slice(0, 160) })), greeting: cfg.greeting });
          for await (const token of llm.chat({ messages: [{ role: "system", content: system }, ...input.messages], signal: req.signal })) {
            first ??= Date.now() - t0;
            chars += token.length;
            send("token", token);
          }
          send("done", { firstTokenMs: first, totalMs: Date.now() - t0 });
          await logUsage(getDb(), { orgId: user.orgId, userId: user.id, provider: "askg1", operation: "chat", status: "ok", latencyMs: first ?? Date.now() - t0, units: chars });
        } catch (err) {
          const message = err instanceof Error ? err.message : "AskG1 failed";
          send("error", { message: /fetch failed|ECONN|EHOSTUNREACH|ETIMEDOUT|ENOTFOUND|AbortError|did not answer/.test(message) ? "AskG1 is not reachable. Connect the company VPN and try again." : message });
          await logUsage(getDb(), { orgId: user.orgId, userId: user.id, provider: "askg1", operation: "chat", status: "error", latencyMs: Date.now() - t0, error: message });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive" } });
  });
