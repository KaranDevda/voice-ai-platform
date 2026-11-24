import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { callBookings, leads, roles, userRoles, users } from "./schema";

export interface NewCallBooking {
  callerName: string;
  scheduledFor: Date;
  language: "en" | "hi" | "hinglish";
  leadId?: string | null;
  callId?: string | null;
  bookedByUserId?: string | null;
  /** True when the caller changed an earlier booking in the same call: that one is cancelled. */
  replacesEarlier?: boolean;
}

/**
 * Saves a callback or demo the AI booked on a call (written by the voice service, as the system, for the call's organisation).
 * A change in the same call cancels the earlier booking instead of leaving two. The lead (if known) is marked
 * "callback_requested". Returns who to tell (active admins and managers) so the caller can e-mail them.
 */
export async function saveCallBooking(db: Db, orgId: string, b: NewCallBooking): Promise<{ id: string; notify: string[]; leadName: string | null }> {
  const name = b.callerName.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw new Error("a booking needs the caller's name");
  if (Number.isNaN(b.scheduledFor.getTime())) throw new Error("a booking needs a valid time");
  return withOrg(db, orgId, async (tx) => {
    if (b.replacesEarlier && b.callId) {
      await tx.update(callBookings).set({ status: "cancelled" }).where(and(eq(callBookings.callId, b.callId), eq(callBookings.status, "requested")));
    }
    const [row] = await tx.insert(callBookings).values({
      orgId, leadId: b.leadId ?? null, callId: b.callId ?? null, bookedByUserId: b.bookedByUserId ?? null,
      callerName: name, scheduledFor: b.scheduledFor, language: b.language,
    }).returning({ id: callBookings.id });
    let leadName: string | null = null;
    if (b.leadId) {
      const [lead] = await tx.select({ name: leads.name, status: leads.status }).from(leads).where(eq(leads.id, b.leadId));
      leadName = lead?.name ?? null;
      if (lead && lead.status !== "callback_requested" && lead.status !== "won") await tx.update(leads).set({ status: "callback_requested" }).where(eq(leads.id, b.leadId));
    }
    await writeAudit(tx, { orgId, action: "call_booking.create", entity: "call_bookings", entityId: row!.id, after: { callerName: name, scheduledFor: b.scheduledFor.toISOString(), language: b.language, callId: b.callId ?? null } });
    const people = await tx.selectDistinct({ email: users.email }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.orgId, orgId), eq(users.status, "active"), inArray(roles.key, ["org_admin", "manager"])));
    return { id: row!.id, notify: people.map((p) => p.email), leadName };
  });
}

/** Upcoming and recent bookings for the organisation (needs calls.read), newest first. */
export async function listCallBookings(db: Db, actor: AuthUser, o: { sinceDays?: number; limit?: number } = {}) {
  assertAuthorized(actor, "calls.read");
  const since = new Date(Date.now() - (o.sinceDays ?? 30) * 86_400_000);
  return withOrg(db, actor.orgId, (tx) => tx
    .select({ id: callBookings.id, callerName: callBookings.callerName, scheduledFor: callBookings.scheduledFor, language: callBookings.language, status: callBookings.status, leadId: callBookings.leadId, callId: callBookings.callId, createdAt: callBookings.createdAt })
    .from(callBookings)
    .where(and(eq(callBookings.orgId, actor.orgId), gte(callBookings.createdAt, since)))
    .orderBy(desc(callBookings.createdAt))
    .limit(Math.min(o.limit ?? 50, 200)));
}
