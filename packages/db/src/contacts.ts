import { sql } from "drizzle-orm";
import { assertAuthorized, resolveScope, type AuthUser } from "@voiceai/auth";
import { parseContacts, type RowProblem } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { leads, users } from "./schema";

export interface ImportResult { created: number; updated: number; skippedExisting: number; duplicatesInFile: number; problems: RowProblem[] }

/**
 * Adds a contact list (CSV text) as leads. New numbers are created; a number that already exists keeps its name and email and gains the
 * new tags and columns (only for people who may edit all leads; others cannot touch leads they did not create). Invalid numbers and
 * repeats inside the file are reported, not guessed at. Imported people have consent "unknown" and Do Not Disturb off: the calling rules
 * still run before every call, but a Do Not Disturb register scrub is the importer's job.
 */
export async function importContacts(db: Db, actor: AuthUser, input: { text: string; tags?: string[] }): Promise<ImportResult> {
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
    }
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "contacts.import", entity: "leads", after: { created, updated, skippedExisting, duplicatesInFile: duplicates, invalid: problems.length, tags: input.tags ?? [] } });
    return { created, updated, skippedExisting, duplicatesInFile: duplicates, problems: problems.slice(0, 50) };
  });
}
