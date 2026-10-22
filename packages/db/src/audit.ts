import type { DbTx } from "./client";
import { auditLogs } from "./schema";

export interface AuditEntry {
  orgId: string;
  teamId?: string | null;
  actorUserId: string;
  action: string;
  entity: string;
  entityId?: string;
  ip?: string;
  userAgent?: string;
  before?: unknown;
  after?: unknown;
}

/** Pass the same tx as the change itself so the audit row commits or rolls back with it. */
export async function writeAudit(tx: DbTx, entry: AuditEntry) {
  await tx.insert(auditLogs).values(entry);
}
