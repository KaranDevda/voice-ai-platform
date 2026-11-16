import { and, asc, gt, sql } from "drizzle-orm";
import { assertAuthorized, resolveScope, type AuthUser } from "@voiceai/auth";
import { maskPhone, parseContacts, type RowProblem } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { scopeCondition } from "./scoped";
import { leads, users } from "./schema";

export interface ImportResult { created: number; updated: number; skippedExisting: number; duplicatesInFile: number; problems: RowProblem[] }

/**
 * Adds a contact list (CSV text) as leads. New numbers are created; a number that already exists keeps its name and email and gains the
 * new tags and columns (only for people who may edit all leads; others cannot touch leads they did not create). Invalid numbers and
 * repeats inside the file are reported, not guessed at. Imported people have consent "unknown" and Do Not Disturb off: the calling rules
 * still run before every call, but a Do Not Disturb register scrub is the importer's job.
 */
export async function importContacts(db: Db, actor: AuthUser, input: { text: string; tags?: string[] }, onProgress?: (progress: { processed: number; total: number }) => void): Promise<ImportResult> {
  assertAuthorized(actor, "leads.write");
  const { contacts, problems, duplicates } = parseContacts(input.text, input.tags ?? []);
  const wide = resolveScope(actor, "leads.write") === "all";
  return withOrg(db, actor.orgId, async (tx) => {
    const [owner] = await tx.select({ teamId: users.teamId }).from(users).where(sql`${users.id} = ${actor.id}`);
    let created = 0, updated = 0, skippedExisting = 0;
    for (let i = 0; i < contacts.length; i += 200) {
      const chunk = contacts.slice(i, i + 200);
      const insert = tx.insert(leads).values(chunk.map((c) => ({
        orgId: actor.orgId, teamId: owner?.teamId ?? null, ownerUserId: actor.id, name: c.name, phoneE164: c.phone, email: c.email, tags: c.tags, customFields: c.fields, source: "import",
      })));
      if (!wide) {
        const rows = await insert.onConflictDoNothing({ target: [leads.orgId, leads.phoneE164] }).returning({ id: leads.id });
        created += rows.length; skippedExisting += chunk.length - rows.length;
        onProgress?.({ processed: Math.min(i + chunk.length, contacts.length), total: contacts.length });
        continue;
      }
      const rows = await insert.onConflictDoUpdate({
        target: [leads.orgId, leads.phoneE164],
        set: {
          name: sql`coalesce(${leads.name}, excluded.name)`,
          email: sql`coalesce(${leads.email}, excluded.email)`,
          tags: sql`(select coalesce(array_agg(distinct t), '{}'::text[]) from unnest(${leads.tags} || excluded.tags) as t)`,
          customFields: sql`${leads.customFields} || excluded.custom_fields`,
        },
      }).returning({ inserted: sql<boolean>`(xmax = 0)` });
      for (const r of rows) r.inserted ? created++ : updated++;
      onProgress?.({ processed: Math.min(i + chunk.length, contacts.length), total: contacts.length });
    }
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "contacts.import", entity: "leads", after: { created, updated, skippedExisting, duplicatesInFile: duplicates, invalid: problems.length, tags: input.tags ?? [] } });
    return { created, updated, skippedExisting, duplicatesInFile: duplicates, problems: problems.slice(0, 50) };
  });
}

const csvCell = (value: unknown) => {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // prevent spreadsheet formula execution
  return `"${text.replace(/"/g, '""')}"`;
};

/** Stream every contact the actor may export in bounded keyset batches and audit the completed export. */
export function streamContactsCsv(db: Db, actor: AuthUser): ReadableStream<Uint8Array> {
  assertAuthorized(actor, "leads.export");
  const encoder = new TextEncoder();
  const showPhone = actor.permissions.includes("leads.pii.read");
  const visible = scopeCondition(actor, "leads.export", { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void withOrg(db, actor.orgId, async (tx) => {
        controller.enqueue(encoder.encode("name,phone,email,tags,status,source,consent_status,dnd,custom_fields\r\n"));
        let lastId: string | undefined, count = 0;
        while (!cancelled) {
          const where = lastId ? and(visible, gt(leads.id, lastId)) : visible;
          const rows = await tx.select({ id: leads.id, name: leads.name, phone: leads.phoneE164, email: leads.email, tags: leads.tags, status: leads.status, source: leads.source, consent: leads.consentStatus, dnd: leads.dndFlag, customFields: leads.customFields })
            .from(leads).where(where).orderBy(asc(leads.id)).limit(1000);
          if (!rows.length) break;
          for (const r of rows) {
            if (cancelled) break;
            const fields = [r.name, showPhone ? r.phone : maskPhone(r.phone), r.email, r.tags.join("|"), r.status, r.source, r.consent, r.dnd, JSON.stringify(r.customFields)];
            controller.enqueue(encoder.encode(`${fields.map(csvCell).join(",")}\r\n`));
            count++;
          }
          lastId = rows[rows.length - 1]!.id;
        }
        if (!cancelled) await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "leads.export", entity: "leads", after: { count, format: "csv" } });
      }).then(() => { if (!cancelled) controller.close(); }, (err) => { if (!cancelled) controller.error(err); });
    },
    cancel() { cancelled = true; },
  });
}
