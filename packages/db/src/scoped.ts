import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { ForbiddenError, resolveScope, type AuthUser, type ScopedBase } from "@voiceai/auth";
import type { Db } from "./client";
import { callLogs, leads } from "./schema";

interface ScopeColumns {
  orgId: PgColumn;
  teamId: PgColumn;
  /** leads.owner_user_id, call_logs.agent_user_id, ... */
  ownerUserId: PgColumn;
}

/**
 * WHERE fragment for the widest scope the user holds on `base`. Always pins org_id; Postgres RLS
 * repeats that check as the second wall. Aggregate-only and no-permission users get a ForbiddenError:
 * they must use aggregate queries, never record-level ones.
 */
export function scopeCondition(user: AuthUser, base: ScopedBase, cols: ScopeColumns): SQL {
  const scope = resolveScope(user, base);
  if (!scope || scope === "aggregate") throw new ForbiddenError(base, scope ?? "missing_permission");

  const org = eq(cols.orgId, user.orgId);
  switch (scope) {
    case "all":
      return org;
    case "team":
      return user.teamIds.length ? and(org, inArray(cols.teamId, [...user.teamIds]))! : sql`false`;
    case "own":
      return and(org, eq(cols.ownerUserId, user.id))!;
  }
}

/** Repositories that inject the scope filter into every read; route handlers never build these filters by hand. */
export function scopedRepos(db: Db, user: AuthUser) {
  const leadScope = (base: ScopedBase) =>
    scopeCondition(user, base, { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
  const callScope = (base: ScopedBase) =>
    scopeCondition(user, base, { orgId: callLogs.orgId, teamId: callLogs.teamId, ownerUserId: callLogs.agentUserId });

  return {
    leads: {
      list: () => db.select().from(leads).where(leadScope("leads.read")),
      get: async (id: string) =>
        (await db.select().from(leads).where(and(eq(leads.id, id), leadScope("leads.read")))).at(0) ?? null,
    },
    calls: {
      list: () => db.select().from(callLogs).where(callScope("calls.read")),
      get: async (id: string) =>
        (await db.select().from(callLogs).where(and(eq(callLogs.id, id), callScope("calls.read")))).at(0) ?? null,
    },
  };
}
