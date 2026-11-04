import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { organizations } from "./org";

export const CRM_EVENTS = ["call.completed", "call.analyzed", "lead.created", "lead.status_changed"] as const;

/** A web address of the organisation's CRM that receives events. The secret signs every request. */
export const crmEndpoints = pgTable(
  "crm_endpoints",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").array().notNull().default([...CRM_EVENTS]),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("crm_endpoints_org_idx").on(t.orgId), orgIsolationPolicy()],
).enableRLS();

/** One event on its way to one endpoint, with how it went. Created by database triggers; sent and retried by the worker. */
export const crmDeliveries = pgTable(
  "crm_deliveries",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    endpointId: uuid("endpoint_id").notNull().references(() => crmEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "sending", "delivered", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: tstz("next_attempt_at").notNull().defaultNow(),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    deliveredAt: tstz("delivered_at"),
  },
  (t) => [index("crm_deliveries_due_idx").on(t.status, t.nextAttemptAt), index("crm_deliveries_org_created_idx").on(t.orgId, t.createdAt), orgIsolationPolicy()],
).enableRLS();
