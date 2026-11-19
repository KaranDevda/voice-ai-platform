import { sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { writeAudit } from "./audit";
import type { Db } from "./client";

export class ContentError extends Error {}

const audit = async (db: Db, actor: AuthUser, action: string, after: object) =>
  db.transaction(async (tx) => { await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`); await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action, entity: "platform_settings", after }); });

// ------------------------------------------------------------------------------------------ the sign-in page

export async function getLandingText(db: Db): Promise<{ headline: string; text: string }> {
  const r = await db.execute<{ h: string; t: string }>(sql`select landing_headline as h, landing_text as t from platform_settings where id = 1`);
  return { headline: r.rows[0]?.h ?? "", text: r.rows[0]?.t ?? "" };
}

/** Platform staff: the headline and line under the logo on the sign-in page. Empty = the standard text. Plain text only. */
export async function setLandingText(db: Db, actor: AuthUser, input: { headline: string; text: string }) {
  assertAuthorized(actor, "platform.admin");
  const clean = (v: string, max: number, what: string) => { const t = v.normalize("NFC").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim(); if (t.length > max) throw new ContentError(`${what} is too long (at most ${max} characters)`); return t; };
  const headline = clean(input.headline, 60, "the headline"), text = clean(input.text, 140, "the line under it");
  await db.execute(sql`update platform_settings set landing_headline = ${headline}, landing_text = ${text}, updated_at = now() where id = 1`);
  await audit(db, actor, "content.landing", { headline, text });
  return { headline, text };
}

// ------------------------------------------------------------------------------------------ translations

export interface ExtraLanguage { code: string; name: string; rtl: boolean }
export const listExtraLanguages = async (db: Db): Promise<ExtraLanguage[]> =>
  (await db.execute<{ code: string; name: string; rtl: boolean }>(sql`select code, name, rtl from extra_languages order by name`)).rows;

/** Staff-written translations for one language: English text -> text. */
export async function translationOverrides(db: Db, lang: string): Promise<Record<string, string>> {
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(lang)) return {};
  return Object.fromEntries((await db.execute<{ key: string; value: string }>(sql`select key, value from translations where lang = ${lang}`)).rows.map((r) => [r.key, r.value]));
}

/** `builtIn` are the codes shipped in the app: they cannot be added again. */
export async function addLanguage(db: Db, actor: AuthUser, input: ExtraLanguage, builtIn: readonly string[]) {
  assertAuthorized(actor, "platform.admin");
  const code = input.code.trim().toLowerCase(), name = input.name.normalize("NFC").replace(/[\u0000-\u001f<>]/g, "").trim();
  if (!/^[a-z]{2,3}(-[a-z]{2})?$/.test(code)) throw new ContentError("the language code must be 2 or 3 letters, like sw or pt-br");
  if (builtIn.includes(code)) throw new ContentError("that language is already built in: edit its translations instead");
  if (!name || name.length > 40) throw new ContentError("enter the language's name (up to 40 characters), written in that language");
  const stored = code.includes("-") ? `${code.split("-")[0]}-${code.split("-")[1]!.toUpperCase()}` : code;
  if ((await listExtraLanguages(db)).length >= 20) throw new ContentError("at most 20 added languages");
  await db.execute(sql`insert into extra_languages (code, name, rtl) values (${stored}, ${name}, ${!!input.rtl}) on conflict (code) do update set name = excluded.name, rtl = excluded.rtl`);
  await audit(db, actor, "content.language_add", { code: stored, name, rtl: !!input.rtl });
  return { code: stored, name, rtl: !!input.rtl };
}

export async function deleteLanguage(db: Db, actor: AuthUser, code: string) {
  assertAuthorized(actor, "platform.admin");
  await db.transaction(async (tx) => {
    const gone = await tx.execute<{ code: string }>(sql`delete from extra_languages where code = ${code} returning code`);
    if (!gone.rows.length) throw new ContentError("that language was not added");
    await tx.execute(sql`delete from translations where lang = ${code}`);
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "content.language_delete", entity: "platform_settings", after: { code } });
  });
  return { code };
}

/** Sets (or, with an empty value, removes) one translation. `knownKeys` are the texts the interface can translate; `knownLangs` the allowed languages. */
export async function saveTranslation(db: Db, actor: AuthUser, input: { lang: string; key: string; value: string }, knownKeys: readonly string[], knownLangs: readonly string[]) {
  assertAuthorized(actor, "platform.admin");
  if (!knownLangs.includes(input.lang)) throw new ContentError("unknown language");
  if (!knownKeys.includes(input.key)) throw new ContentError("unknown text");
  const value = input.value.normalize("NFC").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
  if (value.length > 300) throw new ContentError("the translation is too long (at most 300 characters)");
  if (!value) await db.execute(sql`delete from translations where lang = ${input.lang} and key = ${input.key}`);
  else await db.execute(sql`insert into translations (lang, key, value, updated_at) values (${input.lang}, ${input.key}, ${value}, now()) on conflict (lang, key) do update set value = excluded.value, updated_at = now()`);
  await audit(db, actor, "content.translation", { lang: input.lang, key: input.key, removed: !value });
  return { lang: input.lang, key: input.key, value };
}

/** Runs `fn` in a transaction with the organisation set, so row-level security lets the org's own rows through. */
const inOrg = <T>(db: Db, actor: AuthUser, fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>) =>
  db.transaction(async (tx) => { await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`); return fn(tx); });

/** Org-scoped: list extra languages with enabled flag. */
export async function listExtraLanguagesOrg(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "platform.admin");
  return (await inOrg(db, actor, (tx) => tx.execute<{ code: string; name: string; nativeName: string; rtl: boolean; enabled: boolean }>(
    sql`select code, name, native_name as "nativeName", rtl, enabled from extra_languages where org_id = ${actor.orgId} order by name`
  ))).rows;
}

/** Org-scoped: upsert an extra language. */
export async function upsertExtraLanguage(db: Db, actor: AuthUser, input: { code: string; name: string; nativeName: string; rtl: boolean }) {
  assertAuthorized(actor, "platform.admin");
  const code = input.code.trim().toLowerCase();
  const name = input.name.normalize("NFC").replace(/[\u0000-\u001f<>]/g, " ").trim();
  const nativeName = input.nativeName.normalize("NFC").replace(/[\u0000-\u001f<>]/g, " ").trim();
  if (!/^[a-z]{2,3}(-[a-z]{2})?$/.test(code)) throw new ContentError("the language code must be 2 or 3 letters, like sw or pt-br");
  if (!name || name.length > 40) throw new ContentError("enter the language's name (up to 40 characters)");
  if (!nativeName || nativeName.length > 40) throw new ContentError("enter the native name (up to 40 characters)");
  const stored = code.includes("-") ? `${code.split("-")[0]}-${code.split("-")[1]!.toUpperCase()}` : code;
  await inOrg(db, actor, (tx) => tx.execute(sql`
    insert into extra_languages (org_id, code, name, native_name, rtl, enabled)
    values (${actor.orgId}, ${stored}, ${name}, ${nativeName}, ${input.rtl}, true)
    on conflict (org_id, code) do update set name = excluded.name, native_name = excluded.native_name, rtl = excluded.rtl, enabled = true
  `));
  return { code: stored, name, nativeName, rtl: input.rtl, enabled: true };
}

/** Org-scoped: update extra language enabled flag. */
export async function updateExtraLanguage(db: Db, actor: AuthUser, code: string, enabled: boolean) {
  assertAuthorized(actor, "platform.admin");
  await inOrg(db, actor, (tx) => tx.execute(sql`update extra_languages set enabled = ${enabled} where org_id = ${actor.orgId} and code = ${code}`));
  return { code, enabled };
}

/** Org-scoped: delete extra language and its translations. */
export async function deleteExtraLanguage(db: Db, actor: AuthUser, code: string) {
  assertAuthorized(actor, "platform.admin");
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from extra_languages where org_id = ${actor.orgId} and code = ${code}`);
    await tx.execute(sql`delete from translations where org_id = ${actor.orgId} and lang = ${code}`);
  });
  return { code };
}

/** Org-scoped: list all translation overrides. */
export async function listTranslationOverridesOrg(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "platform.admin");
  return (await inOrg(db, actor, (tx) => tx.execute<{ key: string; language: string; value: string }>(
    sql`select key, lang as language, value from translations where org_id = ${actor.orgId} order by lang, key`
  ))).rows;
}

/** Org-scoped: upsert a translation override. */
export async function upsertTranslationOverride(db: Db, actor: AuthUser, input: { key: string; language: string; value: string }) {
  assertAuthorized(actor, "platform.admin");
  const value = input.value.normalize("NFC").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) throw new ContentError("value cannot be empty");
  await inOrg(db, actor, (tx) => tx.execute(sql`
    insert into translations (org_id, lang, key, value, updated_at)
    values (${actor.orgId}, ${input.language}, ${input.key}, ${value}, now())
    on conflict (org_id, lang, key) do update set value = excluded.value, updated_at = now()
  `));
  return { key: input.key, language: input.language, value };
}

/** Org-scoped: delete a translation override. */
export async function deleteTranslationOverride(db: Db, actor: AuthUser, key: string, language: string) {
  assertAuthorized(actor, "platform.admin");
  await inOrg(db, actor, (tx) => tx.execute(sql`delete from translations where org_id = ${actor.orgId} and lang = ${language} and key = ${key}`));
  return { key, language };
}
