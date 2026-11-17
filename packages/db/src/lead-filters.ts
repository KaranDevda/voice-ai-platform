import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AuthUser } from "@voiceai/auth";
import { HEATS, LEAD_CONSENT_STATUSES, LEAD_STATUSES, heatRange, type Heat } from "@voiceai/shared";
import { scopeCondition } from "./scoped";
import { callLogs, leads, smsMessages } from "./schema";

export interface LeadFilters {
  q?: string;
  status?: string;
  page?: number;
  tag?: string;
  consent?: string;
  dnd?: string;
  heat?: string;
  sort?: string;
  /** Custom field filter, written `key=value` (case-insensitive exact match) or just `key` (field is set). */
  field?: string;
  /** Contact history: called, texted, or never (no calls and no texts yet). */
  history?: string;
}

export function leadFilterConditions(user: AuthUser, permission: "leads.read" | "leads.export", filters: LeadFilters = {}): SQL[] {
  const conditions: SQL[] = [scopeCondition(user, permission, { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId })];
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    conditions.push(or(ilike(leads.name, like), ilike(leads.phoneE164, like), ilike(leads.email, like))!);
  }
  const status = LEAD_STATUSES.find((candidate) => candidate === filters.status);
  if (status) conditions.push(eq(leads.status, status));
  const tag = filters.tag?.trim();
  if (tag) {
    conditions.push(sql`exists (select 1 from unnest(${leads.tags}) as contact_tag(value) where lower(contact_tag.value) = lower(${tag}))`);
  }
  const consent = LEAD_CONSENT_STATUSES.find((candidate) => candidate === filters.consent);
  if (consent) conditions.push(eq(leads.consentStatus, consent));
  if (filters.dnd === "true") conditions.push(eq(leads.dndFlag, true));
  else if (filters.dnd === "false") conditions.push(eq(leads.dndFlag, false));
  if (filters.heat && (HEATS as readonly string[]).includes(filters.heat)) {
    const [low, high] = heatRange(filters.heat as Heat);
    conditions.push(sql`lead_score("leads"."id") between ${low} and ${high}`);
  }
  const field = filters.field?.trim();
  if (field) {
    const eq = field.indexOf("=");
    const key = (eq === -1 ? field : field.slice(0, eq)).trim();
    const value = eq === -1 ? "" : field.slice(eq + 1).trim();
    if (key) {
      conditions.push(
        value
          ? sql`exists (select 1 from jsonb_each_text(${leads.customFields}) as cf(k, v) where lower(cf.k) = lower(${key}) and lower(cf.v) = lower(${value}))`
          : sql`exists (select 1 from jsonb_each_text(${leads.customFields}) as cf(k, v) where lower(cf.k) = lower(${key}) and cf.v <> '')`,
      );
    }
  }
  const calledBefore = sql`exists (select 1 from ${callLogs} where ${callLogs.leadId} = ${leads.id})`;
  const textedBefore = sql`exists (select 1 from ${smsMessages} where ${smsMessages.leadId} = ${leads.id})`;
  if (filters.history === "called") conditions.push(calledBefore);
  else if (filters.history === "texted") conditions.push(textedBefore);
  else if (filters.history === "never") conditions.push(sql`not ${calledBefore} and not ${textedBefore}`);
  return conditions;
}
