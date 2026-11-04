import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { leads } from "./crm";
import { organizations, users } from "./org";

export const SMS_STATUSES = ["queued", "sending", "sent", "failed", "received"] as const;
export const ENROLLMENT_STATUSES = ["active", "paused", "completed", "stopped"] as const;

/** A text message in or out. Outbound ones wait as "queued" until the worker sends them (inside the calling hours, never to Do Not Disturb). */
export const smsMessages = pgTable(
  "sms_messages",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: SMS_STATUSES }).notNull().default("queued"),
    /** India: the DLT-registered template this text matches. */
    dltTemplateId: text("dlt_template_id"),
    providerUuid: text("provider_uuid"),
    error: text("error"),
    enrollmentId: uuid("enrollment_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    sentAt: tstz("sent_at"),
  },
  (t) => [index("sms_messages_queue_idx").on(t.status, t.createdAt), index("sms_messages_org_created_idx").on(t.orgId, t.createdAt), orgIsolationPolicy()],
).enableRLS();

export const sequences = pgTable(
  "sequences",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  () => [orgIsolationPolicy()],
).enableRLS();

export const sequenceSteps = pgTable(
  "sequence_steps",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** Minutes after the step before it (after enrolling, for the first step). */
    delayMin: integer("delay_min").notNull().default(0),
    body: text("body").notNull(),
    dltTemplateId: text("dlt_template_id"),
  },
  (t) => [uniqueIndex("sequence_steps_position_uq").on(t.sequenceId, t.position), orgIsolationPolicy()],
).enableRLS();

export const sequenceEnrollments = pgTable(
  "sequence_enrollments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    status: text("status", { enum: ENROLLMENT_STATUSES }).notNull().default("active"),
    nextStep: integer("next_step").notNull().default(0),
    nextRunAt: tstz("next_run_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sequence_enrollments_uq").on(t.sequenceId, t.leadId), index("sequence_enrollments_due_idx").on(t.status, t.nextRunAt), orgIsolationPolicy()],
).enableRLS();

/** A saved text that can be reused: its words may include {{name}} style slots that are filled in for each person just before sending. */
export const smsTemplates = pgTable(
  "sms_templates",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    body: text("body").notNull(),
    dltTemplateId: text("dlt_template_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sms_templates_org_name_uq").on(t.orgId, t.name), orgIsolationPolicy()],
).enableRLS();
