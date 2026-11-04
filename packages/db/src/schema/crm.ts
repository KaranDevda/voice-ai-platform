import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, leadConsentStatus, leadStatus, orgIsolationPolicy, statusChanger } from "./_common";
import { organizations, teams, users } from "./org";
import { callLogs } from "./calls";

export const leads = pgTable(
  "leads",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name"),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    source: text("source"),
    status: leadStatus("status").notNull().default("new"),
    score: integer("score"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Extra columns from an imported contact list (city, company, ...), usable as {{variables}} in a campaign. */
    customFields: jsonb("custom_fields").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    dndFlag: boolean("dnd_flag").notNull().default(false),
    consentStatus: leadConsentStatus("consent_status").notNull().default("unknown"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("leads_org_phone_uq").on(t.orgId, t.phoneE164),
    index("leads_team_idx").on(t.teamId),
    index("leads_owner_idx").on(t.ownerUserId),
    orgIsolationPolicy(),
  ],
).enableRLS();

export const leadStatusHistory = pgTable(
  "lead_status_history",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    fromStatus: leadStatus("from_status"),
    toStatus: leadStatus("to_status").notNull(),
    changedBy: statusChanger("changed_by").notNull(),
    /** Set when changedBy = 'user'. */
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    /** AI confidence for ai changes; auto-apply threshold is 0.8 (SOP: auto status rules). */
    confidence: real("confidence"),
    callLogId: uuid("call_log_id").references(() => callLogs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("lead_status_history_lead_idx").on(t.leadId, t.createdAt), orgIsolationPolicy()],
).enableRLS();
