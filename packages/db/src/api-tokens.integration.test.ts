import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@voiceai/auth";
import { createDb } from "./client";
import { authenticateApiToken, createApiToken, listApiTokens, revokeApiToken } from "./api-tokens";
import { apiTokens, organizations, roles, userRoles, users } from "./schema";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("API token PostgreSQL integration", () => {
  const owner = createDb(ownerUrl ?? ""), app = createDb(appUrl ?? "");
  let actor: AuthUser;
  let roleId: string;

  beforeAll(async () => {
    const [org] = await owner.db.insert(organizations).values({ name: "API token test" }).returning();
    const [user] = await owner.db.insert(users).values({ orgId: org!.id, email: `api-token-${Date.now()}@test.invalid`, passwordHash: "unused" }).returning();
    const [role] = await owner.db.insert(roles).values({ orgId: org!.id, key: `api-token-${Date.now()}`, name: "API test", permissions: ["leads.read.own", "calls.place"] }).returning();
    await owner.db.insert(userRoles).values({ userId: user!.id, roleId: role!.id });
    roleId = role!.id;
    actor = { id: user!.id, orgId: org!.id, teamIds: [], permissions: ["leads.read.own", "calls.place"] };
  });

  afterAll(async () => { await owner.pool.end(); await app.pool.end(); });

  it("stores only a hash, narrows to current owner permissions, lists and revokes immediately", async () => {
    const created = await createApiToken(app.db, actor, { name: "Reporting", permissions: ["leads.read.own", "calls.place"], expiresInDays: 30 });
    expect(created.token).toMatch(/^va_[A-Za-z0-9_-]{40,}$/);
    const [stored] = await owner.db.select().from(apiTokens).where(sql`${apiTokens.id} = ${created.id}`);
    expect(stored!.tokenHash).not.toBe(created.token);
    expect(stored!.permissions).toEqual(["leads.read.own", "calls.place"]);
    expect((await listApiTokens(app.db, actor)).map((row) => row.id)).toContain(created.id);

    expect(await authenticateApiToken(app.db, created.token)).toMatchObject({ id: actor.id, permissions: ["leads.read.own", "calls.place"] });
    await owner.db.update(roles).set({ permissions: ["leads.read.own"] }).where(sql`${roles.id} = ${roleId}`);
    expect(await authenticateApiToken(app.db, created.token)).toMatchObject({ permissions: ["leads.read.own"] });

    expect(await revokeApiToken(app.db, actor, created.id)).toBe(true);
    expect(await authenticateApiToken(app.db, created.token)).toBeNull();
    const actions = await owner.db.execute(sql`select action from audit_logs where entity_id = ${created.id} order by at`);
    expect(actions.rows.map((row) => row.action)).toEqual(["api_token.create", "api_token.revoke"]);
  });
});
