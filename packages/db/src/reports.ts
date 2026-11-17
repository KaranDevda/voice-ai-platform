import { and, asc, eq, gt } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { withOrg, type Db } from "./client";
import { writeAudit } from "./audit";
import { type LeadFilters } from "./lead-filters";
import { callLogs, leads, smsMessages } from "./schema";

const csvCell = (value: unknown) => {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const encoder = new TextEncoder();

/** Stream the actor's permitted call logs as CSV and audit the export. */
export function streamCallsCsv(db: Db, actor: AuthUser, filters: LeadFilters = {}): ReadableStream<Uint8Array> {
  assertAuthorized(actor, "leads.export");
  const conditions = [eq(callLogs.orgId, actor.orgId)];
  let cancelled = false;
  let count = 0;
  let lastId: string | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void withOrg(db, actor.orgId, async (tx) => {
        controller.enqueue(encoder.encode("id,started_at,direction,source,status,duration_s,lead_name,lead_phone,agent_email\r\n"));
        while (!cancelled) {
          const where = lastId ? and(...conditions, gt(callLogs.id, lastId)) : and(...conditions);
          const rows = await tx
            .select({ id: callLogs.id, startedAt: callLogs.startedAt, direction: callLogs.direction, source: callLogs.source, status: callLogs.status, durationS: callLogs.durationS, leadName: leads.name, leadPhone: leads.phoneE164, agentEmail: (({} as any).email) })
            .from(callLogs).leftJoin(leads, eq(leads.id, callLogs.leadId)).where(where).orderBy(asc(callLogs.id)).limit(1000);
          if (!rows.length) break;
          for (const r of rows) {
            if (cancelled) break;
            const fields = [r.id, r.startedAt, r.direction, r.source, r.status, r.durationS, r.leadName ?? "", r.leadPhone ?? "", r.agentEmail ?? ""];
            controller.enqueue(encoder.encode(`${fields.map(csvCell).join(",")}\r\n`));
            count++;
          }
          lastId = rows[rows.length - 1]!.id;
        }
        if (!cancelled) await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "calls.export", entity: "calls", after: { count, format: "csv" } });
      }).then(() => { if (!cancelled) controller.close(); }, (err) => { if (!cancelled) controller.error(err); });
    },
    cancel() { cancelled = true; },
  });
}

/** Stream SMS messages for the actor's org as CSV and audit the export. */
export function streamSmsCsv(db: Db, actor: AuthUser, filters: LeadFilters = {}): ReadableStream<Uint8Array> {
  assertAuthorized(actor, "leads.export");
  const conditions = [eq(smsMessages.orgId, actor.orgId)];
  let cancelled = false;
  let count = 0;
  let lastId: string | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void withOrg(db, actor.orgId, async (tx) => {
        controller.enqueue(encoder.encode("id,created_at,direction,lead_id,status,body\r\n"));
        while (!cancelled) {
          const where = lastId ? and(...conditions, gt(smsMessages.id, lastId)) : and(...conditions);
          const rows = await tx.select({ id: smsMessages.id, createdAt: smsMessages.createdAt, direction: smsMessages.direction, status: smsMessages.status, body: smsMessages.body, leadId: smsMessages.leadId }).from(smsMessages).where(where).orderBy(asc(smsMessages.id)).limit(1000);
          if (!rows.length) break;
          for (const r of rows) {
            if (cancelled) break;
            const fields = [r.id, r.createdAt, r.direction, r.leadId ?? "", r.status, r.body];
            controller.enqueue(encoder.encode(`${fields.map(csvCell).join(",")}\r\n`));
            count++;
          }
          lastId = rows[rows.length - 1]!.id;
        }
        if (!cancelled) await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sms.export", entity: "sms", after: { count, format: "csv" } });
      }).then(() => { if (!cancelled) controller.close(); }, (err) => { if (!cancelled) controller.error(err); });
    },
    cancel() { cancelled = true; },
  });
}
