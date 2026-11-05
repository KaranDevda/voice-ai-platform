import { randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { widgets } from "./schema";

export class WidgetError extends Error {}

/** "https://shop.example.com" (no path); plain http only for localhost. Returns the origin, or null when it is not a usable site. */
export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
    return u.origin;
  } catch { return null; }
}

export async function listWidgets(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, (tx) => tx.select({ id: widgets.id, name: widgets.name, key: widgets.key, origins: widgets.origins, language: widgets.language, active: widgets.active, createdAt: widgets.createdAt }).from(widgets).orderBy(desc(widgets.createdAt)));
}

export async function createWidget(db: Db, actor: AuthUser, input: { name: string; origins: string[]; language: "en" | "hi" | "en-hi"; voice?: string | null }) {
  assertAuthorized(actor, "org_settings.write");
  assertAuthorized(actor, "studio.use");
  const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) throw new WidgetError("enter a name of up to 80 characters");
  const origins = [...new Set(input.origins.map((o) => normalizeOrigin(o)))];
  if (origins.length === 0 || origins.length > 10 || origins.includes(null)) throw new WidgetError("list 1 to 10 sites like https://www.example.com (https only, no path)");
  const key = `wk_${randomBytes(18).toString("hex")}`;
  return withOrg(db, actor.orgId, async (tx) => {
    if ((await tx.select({ id: widgets.id }).from(widgets)).length >= 10) throw new WidgetError("at most 10 widgets; remove one first");
    const [row] = await tx.insert(widgets).values({ orgId: actor.orgId, name, key, origins: origins as string[], language: input.language, voice: input.voice || null, createdBy: actor.id }).returning({ id: widgets.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "widget.create", entity: "widgets", entityId: row!.id, after: { name, origins } });
    return { id: row!.id, key };
  });
}

export async function updateWidget(db: Db, actor: AuthUser, id: string, action: "enable" | "disable" | "delete") {
  assertAuthorized(actor, "org_settings.write");
  return withOrg(db, actor.orgId, async (tx) => {
    const [w] = await tx.select({ id: widgets.id }).from(widgets).where(eq(widgets.id, id));
    if (!w) throw new WidgetError("widget not found");
    if (action === "delete") await tx.delete(widgets).where(eq(widgets.id, id));
    else await tx.update(widgets).set({ active: action === "enable" }).where(eq(widgets.id, id));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: `widget.${action}`, entity: "widgets", entityId: id });
    return { id, action };
  });
}

export interface WidgetLookup { id: string; orgId: string; createdBy: string; origins: string[]; language: "en" | "hi" | "en-hi"; voice: string | null; active: boolean }

/** For a visitor's browser (no sign-in): the widget behind a public key, or null. */
export async function findWidget(db: Db, key: string): Promise<WidgetLookup | null> {
  if (!/^wk_[0-9a-f]{36}$/.test(key)) return null;
  const r = await db.execute<{ id: string; org_id: string; created_by: string; origins: string[]; language: "en" | "hi" | "en-hi"; voice: string | null; active: boolean }>(sql`select * from widget_find(${key})`);
  const w = r.rows[0];
  return w ? { id: w.id, orgId: w.org_id, createdBy: w.created_by, origins: w.origins, language: w.language, voice: w.voice, active: w.active } : null;
}
