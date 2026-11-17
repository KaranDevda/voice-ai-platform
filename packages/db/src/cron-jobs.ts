import { and, desc, eq, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { withOrg, type Db, type DbTx } from "./client";
import { writeAudit } from "./audit";
import { scopeCondition } from "./scoped";
import { cronJobs, organizations, teams, users } from "./schema";

export interface CronJobInput {
  name: string;
  reportType: "contacts" | "calls" | "sms";
  cron: string;
  timezone: string;
  email?: string | null;
}

export async function createCronJob(db: Db, actor: AuthUser, input: CronJobInput) {
  assertAuthorized(actor, "leads.export");
  return withOrg(db, actor.orgId, async (tx) => {
    const [job] = await tx.insert(cronJobs).values({
      orgId: actor.orgId,
      teamId: actor.teamIds[0] ?? null,
      userId: actor.id,
      name: input.name,
      reportType: input.reportType,
      cron: input.cron,
      timezone: input.timezone,
      email: input.email ?? null,
      active: true,
    }).returning();
    if (!job) throw new Error("Failed to create cron job");
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "cron_job.create", entity: "cron_jobs", entityId: job.id, after: { ...input, active: true } });
    return job;
  });
}

export async function listCronJobs(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "leads.export");
  return withOrg(db, actor.orgId, async (tx) => {
    const rows = await tx.select({
      id: cronJobs.id,
      name: cronJobs.name,
      reportType: cronJobs.reportType,
      cron: cronJobs.cron,
      timezone: cronJobs.timezone,
      email: cronJobs.email,
      active: cronJobs.active,
      nextRun: cronJobs.nextRun,
      lastRun: cronJobs.lastRun,
      createdAt: cronJobs.createdAt,
    }).from(cronJobs).where(eq(cronJobs.orgId, actor.orgId)).orderBy(desc(cronJobs.createdAt));
    return rows;
  });
}

export async function updateCronJob(db: Db, actor: AuthUser, id: string, patch: { active?: boolean; cron?: string; email?: string | null }) {
  assertAuthorized(actor, "leads.export");
  return withOrg(db, actor.orgId, async (tx) => {
    const [job] = await tx.update(cronJobs).set(patch).where(and(eq(cronJobs.id, id), eq(cronJobs.orgId, actor.orgId))).returning();
    if (!job) throw new Error("Cron job not found");
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "cron_job.update", entity: "cron_jobs", entityId: id, after: patch });
    return job;
  });
}

export async function deleteCronJob(db: Db, actor: AuthUser, id: string) {
  assertAuthorized(actor, "leads.export");
  return withOrg(db, actor.orgId, async (tx) => {
    await tx.delete(cronJobs).where(and(eq(cronJobs.id, id), eq(cronJobs.orgId, actor.orgId)));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "cron_job.delete", entity: "cron_jobs", entityId: id });
  });
}