import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { organizations, users } from "./org";
import { leads } from "./crm";

/** A callback or demo the AI booked during a call: the caller's name and the day and time they chose (stored as an instant). */
export const callBookings = pgTable(
  "call_bookings",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    callId: uuid("call_id"),
    bookedByUserId: uuid("booked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    callerName: text("caller_name").notNull(),
    scheduledFor: tstz("scheduled_for").notNull(),
    language: text("language", { enum: ["en", "hi", "hinglish"] }).notNull().default("en"),
    status: text("status", { enum: ["requested", "confirmed", "done", "cancelled"] }).notNull().default("requested"),
    source: text("source").notNull().default("voice_ai"),
    createdAt: createdAt(),
  },
  (t) => [index("call_bookings_org_time_idx").on(t.orgId, t.scheduledFor), orgIsolationPolicy()],
).enableRLS();
