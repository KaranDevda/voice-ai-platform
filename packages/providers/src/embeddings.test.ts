import { describe, expect, it } from "vitest";
import { createEmbeddings, embeddingsFromEnv, EMBEDDING_DIMENSIONS } from "./embeddings";

const vector = (n: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i === n ? 1 : 0);

describe("embeddings provider", () => {
  it("orders the endpoint's results by input index", async () => {
    const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "test-model", input: ["first", "second"], dimensions: EMBEDDING_DIMENSIONS });
      return Response.json({ data: [{ index: 1, embedding: vector(1) }, { index: 0, embedding: vector(0) }] });
    }) as typeof globalThis.fetch;
    await expect(createEmbeddings({ url: "http://local/embeddings", model: "test-model", fetch }).embed(["first", "second"]))
      .resolves.toEqual([vector(0), vector(1)]);
  });

  it("rejects malformed or wrong-sized vectors instead of persisting unusable data", async () => {
    const fetch = (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: [{ index: 0, embedding: [1, 0] }] })) as typeof globalThis.fetch;
    await expect(createEmbeddings({ url: "http://local/embeddings", model: "test-model", fetch }).embed(["text"]))
      .rejects.toThrow(/1536 finite values/);
  });

  it("keeps embeddings opt-in and rejects partial configuration", () => {
    expect(embeddingsFromEnv({})).toBeNull();
    expect(() => embeddingsFromEnv({ EMBEDDING_URL: "http://localhost/v1/embeddings" })).toThrow(/EMBEDDING_MODEL/);
  });
});
