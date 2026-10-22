import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, devicePlatform, id, orgIsolationPolicy, tstz, userStatus } from "./_common";

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default({}),
  /** Transcripts and insights, days. SOP default: 1 year. */
  dataRetentionDays: integer("data_retention_days").notNull().default(365),
  /** Recordings, days. SOP default: 180 (split from data_retention_days because defaults differ). */
  recordingRetentionDays: integer("recording_retention_days").notNull().default(180),
  createdAt: createdAt(),
});

export const teams = pgTable(
  "teams",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    managerUserId: uuid("manager_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [unique("teams_org_name_uq").on(t.orgId, t.name), orgIsolationPolicy()],
).enableRLS();

export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references((): AnyPgColumn => teams.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    /** Encrypted at app level (SOP: Data protection). */
    mfaSecretEnc: text("mfa_secret_enc"),
    /** Last accepted TOTP time step; codes at or before it are rejected (replay guard). */
    mfaLastStep: bigint("mfa_last_step", { mode: "number" }),
    status: userStatus("status").notNull().default("active"),
    /** Lockout after 5 failed logins (SOP: Authentication). */
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    lastLoginAt: tstz("last_login_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_org_team_idx").on(t.orgId, t.teamId), orgIsolationPolicy()],
).enableRLS();

/** org_id null = system role seeded by us; set = org-specific custom role. */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [unique("roles_org_key_uq").on(t.orgId, t.key).nullsNotDistinct()],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: devicePlatform("platform").notNull().default("android"),
    deviceFingerprint: text("device_fingerprint").notNull(),
    workSimSlot: integer("work_sim_slot"),
    lastSyncAt: tstz("last_sync_at"),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [unique("devices_user_fingerprint_uq").on(t.userId, t.deviceFingerprint), orgIsolationPolicy()],
).enableRLS();
