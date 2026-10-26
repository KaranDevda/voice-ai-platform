import { describe, expect, it } from "vitest";
import type { LlmAdapter } from "@voiceai/providers";
import { withFailover } from "./llm-failover";

const say = (tokens: string[], opts: { failAfter?: number; failFirst?: boolean; hang?: boolean } = {}): LlmAdapter & { calls: number } => {
  const a = {
    calls: 0,
    respond: () => (async function* () {})(),
    async *chat({ signal }: { signal?: AbortSignal }) {
      a.calls++;
      if (opts.failFirst) throw new Error("fetch failed");
      if (opts.hang) await new Promise((_, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted"))));
      let i = 0;
      for (const t of tokens) { if (opts.failAfter === i++) throw new Error("dropped"); yield t; }
    },
  };
  return a;
};
const text = async (m: LlmAdapter, signal?: AbortSignal) => { let s = ""; for await (const t of m.chat({ messages: [], signal })) s += t; return s; };

describe("withFailover", () => {
  it("uses the main model when it works, and never touches the backup", async () => {
    const main = say(["Hi ", "there"]), backup = say(["backup"]);
    expect(await text(withFailover(main, backup))).toBe("Hi there");
    expect(backup.calls).toBe(0);
  });
  it("answers from the backup when the main model cannot be reached, and says why", async () => {
    const whys: string[] = [];
    const m = withFailover(say([], { failFirst: true }), say(["from backup"]), { onBackup: (w) => whys.push(w) });
    expect(await text(m)).toBe("from backup");
    expect(whys).toEqual(["fetch failed"]);
  });
  it("goes straight to the backup for a while after a failure, then tries the main model again", async () => {
    let t = 0;
    const main = say(["main"], { failFirst: true }), backup = say(["backup"]);
    const m = withFailover(main, backup, { coolDownMs: 1000, now: () => t });
    await text(m); await text(m);
    expect(main.calls).toBe(1);
    t = 1500; await text(m);
    expect(main.calls).toBe(2);
  });
  it("uses the backup when the main model says nothing in time", async () => {
    const m = withFailover(say([], { hang: true }), say(["backup"]), { firstTokenTimeoutMs: 30 });
    expect(await text(m)).toBe("backup");
  });
  it("does not swap models once the main model has started answering", async () => {
    const m = withFailover(say(["Part one. ", "part two"], { failAfter: 1 }), say(["backup"]));
    await expect(text(m)).rejects.toThrow("dropped");
  });
  it("explains in words when both models fail", async () => {
    const m = withFailover(say([], { failFirst: true }), say([], { failFirst: true }));
    await expect(text(m)).rejects.toThrow(/could not be reached.*AskG1 \(fetch failed\).*backup/);
  });
  it("is not a failure when the caller interrupts", async () => {
    const whys: string[] = [];
    const ac = new AbortController();
    const m = withFailover(say([], { hang: true }), say(["backup"]), { onBackup: (w) => whys.push(w) });
    setTimeout(() => ac.abort(), 20);
    expect(await text(m, ac.signal)).toBe("");
    expect(whys).toEqual([]);
  });
});
