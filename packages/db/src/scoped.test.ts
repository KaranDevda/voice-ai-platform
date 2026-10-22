import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ForbiddenError, ROLE_PERMISSIONS, type AuthUser, type RoleKey } from "@voiceai/auth";
import { scopeCondition } from "./scoped";
import { leads } from "./schema";

const cols = { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId };
const user = (role: RoleKey, over: Partial<AuthUser> = {}): AuthUser => ({
  id: "u1",
  orgId: "org1",
  teamIds: ["teamA"],
  permissions: ROLE_PERMISSIONS[role],
  ...over,
});
const render = (u: AuthUser) => new PgDialect().sqlToQuery(scopeCondition(u, "leads.read", cols));

describe("scopeCondition", () => {
  it("pins org only for org admins", () => {
    const q = render(user("org_admin"));
    expect(q.sql).toBe('"leads"."org_id" = $1');
    expect(q.params).toEqual(["org1"]);
  });

  it("restricts a Manager to their teams, so another team's rows cannot match", () => {
    const q = render(user("manager", { teamIds: ["teamA", "teamC"] }));
    expect(q.sql).toContain('"leads"."team_id" in ($2, $3)');
    expect(q.params).toEqual(["org1", "teamA", "teamC"]);
  });

  it("matches nothing for a Manager with no teams", () => {
    expect(render(user("manager", { teamIds: [] })).sql).toBe("false");
  });

  it("restricts an Agent to owned rows", () => {
    expect(render(user("agent")).params).toEqual(["org1", "u1"]);
  });

  it("refuses aggregate-only and unprivileged users", () => {
    expect(() => render(user("viewer"))).toThrow(ForbiddenError);
    expect(() => render(user("agent", { permissions: [] }))).toThrow(ForbiddenError);
  });
});
