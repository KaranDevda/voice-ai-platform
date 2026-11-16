import { ProviderError } from "./types";

export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingsConfig {
  url: string;
  model: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

type EmbeddingItem = { index: number; embedding: number[] };

function embeddingItems(value: unknown): EmbeddingItem[] | null {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data)) return null;
  const items: EmbeddingItem[] = [];
  for (const item of value.data) {
    if (!item || typeof item !== "object" || !("index" in item) || !("embedding" in item)) return null;
    const { index, embedding } = item;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || !Array.isArray(embedding) ||
      embedding.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
    items.push({ index, embedding });
  }
  return items;
}

/** OpenAI-compatible embeddings endpoint; vectors must match the pgvector schema dimension. */
export function createEmbeddings(config: EmbeddingsConfig) {
  const doFetch = config.fetch ?? fetch;
  return {
    async embed(input: string[]): Promise<number[][]> {
      if (!input.length) return [];
      const response = await doFetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: config.model, input, dimensions: EMBEDDING_DIMENSIONS }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new ProviderError(`embedding service returned ${response.status}`, response.status, "embeddings");
      const items = embeddingItems(await response.json().catch(() => null));
      if (!items || items.length !== input.length) {
        throw new ProviderError("embedding service returned an invalid response", 502, "embeddings");
      }
      const ordered = [...items].sort((a, b) => a.index - b.index);
      if (ordered.some((item, index) =>
        item.index !== index ||
        item.embedding.length !== EMBEDDING_DIMENSIONS ||
        item.embedding.some((value) => !Number.isFinite(value)),
      )) {
        throw new ProviderError(`embedding service must return ${EMBEDDING_DIMENSIONS} finite values per input`, 502, "embeddings");
      }
      return ordered.map((item) => item.embedding);
    },
  };
}

/** Returns null when embeddings are deliberately not configured, preserving keyword-only operation. */
export function embeddingsFromEnv(env: Record<string, string | undefined> = process.env) {
  const url = env.EMBEDDING_URL?.trim();
  const model = env.EMBEDDING_MODEL?.trim();
  const apiKey = env.EMBEDDING_API_KEY?.trim();
  if (!url && !model && !apiKey) return null;
  if (!url || !model) throw new Error("set both EMBEDDING_URL and EMBEDDING_MODEL to enable semantic knowledge search");
  return createEmbeddings({ url, model, apiKey: apiKey || undefined });
}
