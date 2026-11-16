import { and, desc, eq, gt, gte, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { assertAuthorized, ForbiddenError, resolveScope, type AuthUser } from "@voiceai/auth";
import { chunkText, searchTerms } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { scopeCondition } from "./scoped";
import { EMBEDDING_DIMENSIONS, kbChunks, kbDocuments, providerUsage, studioAssets, users } from "./schema";

const assetCols = { orgId: studioAssets.orgId, teamId: studioAssets.teamId, ownerUserId: studioAssets.userId };
const summaryColumns = {
  id: studioAssets.id, kind: studioAssets.kind, title: studioAssets.title, provider: studioAssets.provider, voiceRef: studioAssets.voiceRef,
  mime: studioAssets.mime, durationMs: studioAssets.durationMs, createdAt: studioAssets.createdAt, userId: studioAssets.userId,
  hasAudio: sql<boolean>`${studioAssets.audio} is not null`, ownerEmail: users.email,
};

// ------------------------------------------------------------------ projects

export interface NewAsset {
  kind: "speech" | "transcript";
  title: string;
  text: string;
  provider: string;
  voiceRef?: string | null;
  mime?: string | null;
  audio?: Uint8Array | null;
  durationMs?: number | null;
  meta?: Record<string, unknown>;
}

export async function saveAsset(db: Db, user: AuthUser, a: NewAsset) {
  assertAuthorized(user, "studio.use");
  return withOrg(db, user.orgId, async (tx) => {
    const [row] = await tx
      .insert(studioAssets)
      .values({
        orgId: user.orgId, teamId: user.teamIds[0] ?? null, userId: user.id, kind: a.kind, title: a.title.slice(0, 200), text: a.text,
        provider: a.provider, voiceRef: a.voiceRef ?? null, mime: a.mime ?? null, audio: a.audio ? Buffer.from(a.audio) : null,
        durationMs: a.durationMs ?? null, meta: a.meta ?? {},
      })
      .returning({ id: studioAssets.id, title: studioAssets.title, createdAt: studioAssets.createdAt });
    return row!;
  });
}

export async function listAssets(db: Db, user: AuthUser, f: { kind?: "speech" | "transcript"; q?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, f.page ?? 1);
  const size = f.pageSize ?? 12;
  const conds: SQL[] = [scopeCondition(user, "projects.read", assetCols)];
  if (f.kind) conds.push(eq(studioAssets.kind, f.kind));
  if (f.q?.trim()) conds.push(or(ilike(studioAssets.title, `%${f.q.trim()}%`), ilike(studioAssets.text, `%${f.q.trim()}%`))!);
  const rows = await withOrg(db, user.orgId, (tx) =>
    tx
      .select(summaryColumns)
      .from(studioAssets)
      .innerJoin(users, eq(users.id, studioAssets.userId))
      .where(and(...conds))
      .orderBy(desc(studioAssets.createdAt))
      .limit(size + 1)
      .offset((page - 1) * size),
  );
  return { rows: rows.slice(0, size), hasMore: rows.length > size, page };
}

export async function getAsset(db: Db, user: AuthUser, id: string) {
  const [row] = await withOrg(db, user.orgId, (tx) =>
    tx
      .select({ ...summaryColumns, text: studioAssets.text, meta: studioAssets.meta })
      .from(studioAssets)
      .innerJoin(users, eq(users.id, studioAssets.userId))
      .where(and(eq(studioAssets.id, id), scopeCondition(user, "projects.read", assetCols))),
  );
  return row ?? null;
}

export async function getAssetAudio(db: Db, user: AuthUser, id: string) {
  const [row] = await withOrg(db, user.orgId, (tx) =>
    tx
      .select({ mime: studioAssets.mime, audio: studioAssets.audio })
      .from(studioAssets)
      .where(and(eq(studioAssets.id, id), scopeCondition(user, "projects.read", assetCols))),
  );
  return row?.audio ? { mime: row.mime ?? "application/octet-stream", audio: row.audio } : null;
}

export async function deleteAsset(db: Db, user: AuthUser, id: string): Promise<boolean> {
  return withOrg(db, user.orgId, async (tx) => {
    const [row] = await tx
      .select({ id: studioAssets.id, userId: studioAssets.userId, teamId: studioAssets.teamId, orgId: studioAssets.orgId, title: studioAssets.title })
      .from(studioAssets)
      .where(and(eq(studioAssets.id, id), scopeCondition(user, "projects.delete", assetCols)));
    // Out-of-scope looks exactly like missing, so a caller cannot probe which ids exist.
    if (!row) return false;
    assertAuthorized(user, "projects.delete", { orgId: row.orgId, teamId: row.teamId, ownerUserId: row.userId });
    await tx.delete(studioAssets).where(eq(studioAssets.id, id));
    await writeAudit(tx, { orgId: user.orgId, actorUserId: user.id, action: "project.delete", entity: "studio_assets", entityId: id, before: { title: row.title } });
    return true;
  });
}

// --------------------------------------------------------------------- usage

export interface UsageEntry {
  orgId: string;
  userId?: string | null;
  provider: string;
  operation: string;
  status: "ok" | "error";
  latencyMs: number;
  units?: number;
  error?: string | null;
}

/** Best-effort: a failed log write must never fail the user's request. */
export async function logUsage(db: Db, e: UsageEntry): Promise<void> {
  try {
    await withOrg(db, e.orgId, (tx) =>
      tx.insert(providerUsage).values({ orgId: e.orgId, userId: e.userId ?? null, provider: e.provider, operation: e.operation, status: e.status, latencyMs: Math.round(e.latencyMs), units: e.units ?? 0, error: e.error?.slice(0, 500) ?? null }),
    );
  } catch (err) {
    console.error("usage log failed", err);
  }
}

export async function listUsage(db: Db, user: AuthUser, f: { page?: number; status?: string } = {}) {
  assertAuthorized(user, "logs.read");
  const page = Math.max(1, f.page ?? 1);
  const size = 25;
  const since = new Date(Date.now() - 86_400_000);
  return withOrg(db, user.orgId, async (tx) => {
    const rows = await tx
      .select({ id: providerUsage.id, at: providerUsage.createdAt, provider: providerUsage.provider, operation: providerUsage.operation, status: providerUsage.status, latencyMs: providerUsage.latencyMs, units: providerUsage.units, error: providerUsage.error, email: users.email })
      .from(providerUsage)
      .leftJoin(users, eq(users.id, providerUsage.userId))
      .where(f.status ? eq(providerUsage.status, f.status) : undefined)
      .orderBy(desc(providerUsage.createdAt))
      .limit(size + 1)
      .offset((page - 1) * size);

    const summary = await tx
      .select({
        provider: providerUsage.provider, operation: providerUsage.operation,
        calls: sql<number>`count(*)`.mapWith(Number), errors: sql<number>`count(*) filter (where ${providerUsage.status} = 'error')`.mapWith(Number),
        avgMs: sql<number>`coalesce(avg(${providerUsage.latencyMs}), 0)`.mapWith(Number), units: sql<number>`coalesce(sum(${providerUsage.units}), 0)`.mapWith(Number),
      })
      .from(providerUsage)
      .where(gte(providerUsage.createdAt, since))
      .groupBy(providerUsage.provider, providerUsage.operation)
      .orderBy(providerUsage.provider, providerUsage.operation);
    return { rows: rows.slice(0, size), hasMore: rows.length > size, page, summary };
  });
}

/** Today's provider activity for the launchpad; any studio user may see their own org's totals. */
export async function usageToday(db: Db, user: AuthUser) {
  assertAuthorized(user, "studio.use");
  const since = new Date(Date.now() - 86_400_000);
  const [r] = await withOrg(db, user.orgId, (tx) =>
    tx
      .select({ calls: sql<number>`count(*)`.mapWith(Number), errors: sql<number>`count(*) filter (where ${providerUsage.status} = 'error')`.mapWith(Number) })
      .from(providerUsage)
      .where(gte(providerUsage.createdAt, since)),
  );
  return r ?? { calls: 0, errors: 0 };
}

// ------------------------------------------------------------ knowledge base

export async function ingestKnowledge(
  db: Db,
  user: AuthUser,
  input: { title: string; text: string; sourceUrl?: string | null },
  embeddings?: number[][],
) {
  assertAuthorized(user, "kb.write");
  const chunks = chunkText(input.text);
  if (!input.title.trim() || chunks.length === 0) throw new RangeError("title and non-empty text are required");
  if (embeddings && (
    embeddings.length !== chunks.length ||
    embeddings.some((vector) => vector.length !== EMBEDDING_DIMENSIONS || vector.some((n) => !Number.isFinite(n)))
  )) throw new RangeError(`each knowledge chunk must have a ${EMBEDDING_DIMENSIONS}-value embedding`);

  return withOrg(db, user.orgId, async (tx) => {
    const [doc] = await tx
      .insert(kbDocuments)
      .values({ orgId: user.orgId, title: input.title.trim().slice(0, 200), sourceUrl: input.sourceUrl ?? null, metadata: { chars: input.text.length } })
      .returning({ id: kbDocuments.id });
    await tx.insert(kbChunks).values(chunks.map((content, i) => ({
      orgId: user.orgId, documentId: doc!.id, chunkIndex: i, content, embedding: embeddings?.[i] ?? null,
    })));
    await writeAudit(tx, { orgId: user.orgId, actorUserId: user.id, action: "kb.add", entity: "kb_documents", entityId: doc!.id, after: { title: input.title, chunks: chunks.length } });
    return { id: doc!.id, chunks: chunks.length };
  });
}

export async function deleteKnowledgeDoc(db: Db, user: AuthUser, id: string): Promise<boolean> {
  assertAuthorized(user, "kb.write");
  return withOrg(db, user.orgId, async (tx) => {
    const gone = await tx.delete(kbDocuments).where(eq(kbDocuments.id, id)).returning({ id: kbDocuments.id });
    if (gone.length) await writeAudit(tx, { orgId: user.orgId, actorUserId: user.id, action: "kb.delete", entity: "kb_documents", entityId: id });
    return gone.length > 0;
  });
}

/** Semantic nearest-neighbour retrieval when available, with keyword search as a no-embedding fallback. */
export async function searchKnowledge(db: Db, user: AuthUser, query: string, limit = 4, queryEmbedding?: number[]) {
  if (!user.permissions.some((p) => p === "kb.read" || p === "studio.use")) throw new ForbiddenError("kb.read");
  if (queryEmbedding) {
    if (queryEmbedding.length !== EMBEDDING_DIMENSIONS || queryEmbedding.some((n) => !Number.isFinite(n))) {
      throw new RangeError(`query embedding must contain ${EMBEDDING_DIMENSIONS} finite values`);
    }
    const literal = `[${queryEmbedding.join(",")}]`;
    const distance = sql<number>`${kbChunks.embedding} <=> ${literal}::vector`;
    const semantic = await withOrg(db, user.orgId, (tx) =>
      tx
        .select({ content: kbChunks.content, title: kbDocuments.title, score: sql<number>`1 - (${distance})`.mapWith(Number) })
        .from(kbChunks)
        .innerJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
        .where(isNotNull(kbChunks.embedding))
        .orderBy(distance, kbChunks.chunkIndex)
        .limit(limit),
    );
    const relevant = semantic.filter((r) => r.score >= 0.25);
    if (relevant.length) return relevant;
  }
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const esc = (t: string) => t.replace(/[\\%_]/g, "\\$&");
  const score = sql<number>`(${sql.join(terms.map((t) => sql`(case when ${kbChunks.content} ilike ${`%${esc(t)}%`} then 1 else 0 end)`), sql` + `)})`;
  const rows = await withOrg(db, user.orgId, (tx) =>
    tx
      .select({ content: kbChunks.content, title: kbDocuments.title, score: score.mapWith(Number) })
      .from(kbChunks)
      .innerJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
      .where(gt(score, 0))
      .orderBy(desc(score), kbChunks.chunkIndex)
      .limit(limit),
  );
  // Drop weak matches (a chunk sharing one common word with the query) when there is a clearly better one.
  const cutoff = rows.length ? Math.max(1, Math.ceil(rows[0]!.score / 2)) : 1;
  return rows.filter((r) => r.score >= cutoff);
}

/** True when the user may read any studio projects at all (used to hide navigation). */
export const canSeeProjects = (user: AuthUser) => !!resolveScope(user, "projects.read");
