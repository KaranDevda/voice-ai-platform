import { and, eq, inArray, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { leadStatusHistory, leads, roles, userRoles, users } from "./schema";

export interface CallbackRequest {
  leadName: string | null;
  /** Masked: the e-mail goes out of the system, so the full number is not put in it. */
  leadPhoneMasked: string;
  leadId: string;
  /** People to tell: active org admins and managers. */
  emails: string[];
}

const mask = (p: string) => (p.length > 4 ? `${p.slice(0, p.length - 4).replace(/\d/g, "•")}${p.slice(-4)}` : p);

/**
 * A caller asked for a person and nobody answered: book a callback.
 * The lead is moved to "callback_requested" (once; repeats are ignored), the change is written to the
 * status history and the audit log, and the people to tell are returned so the caller can e-mail them.
 * Returns null when the lead no longer exists or a callback was already booked.
 */
export async function requestCallback(db: Db, orgId: string, leadId: string, reason: string): Promise<CallbackRequest | null> {
  return withOrg(db, orgId, async (tx) => {
    const [lead] = await tx.select({ id: leads.id, name: leads.name, phone: leads.phoneE164, status: leads.status }).from(leads).where(eq(leads.id, leadId));
    if (!lead || lead.status === "callback_requested") return null;
    await tx.update(leads).set({ status: "callback_requested" }).where(eq(leads.id, leadId));
    await tx.insert(leadStatusHistory).values({ orgId, leadId, fromStatus: lead.status, toStatus: "callback_requested", changedBy: "ai", reason });
    await writeAudit(tx, { orgId, action: "lead.callback_requested", entity: "leads", entityId: leadId, after: { reason } });
    const people = await tx.selectDistinct({ email: users.email }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.orgId, orgId), eq(users.status, "active"), inArray(roles.key, ["org_admin", "manager", "team_manager"])));
    return { leadId, leadName: lead.name, leadPhoneMasked: mask(lead.phone), emails: people.map((p) => p.email) };
  });
}
