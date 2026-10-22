import { describe, expect, it } from "vitest";
import { authorize, resolveScope, type AuthUser } from "./authorize";
import { ROLE_PERMISSIONS, type RoleKey } from "./roles";

const userWith = (role: RoleKey, over: Partial<AuthUser> = {}): AuthUser => ({
  id: "u1",
  orgId: "org1",
  teamIds: ["teamA"],
  permissions: ROLE_PERMISSIONS[role],
  ...over,
});

describe("authorize", () => {
  it("lets a Manager read their own team's leads but not another team's", () => {
    const m = userWith("manager");
    expect(authorize(m, "leads.read", { orgId: "org1", teamId: "teamA" }).allowed).toBe(true);
    const other = authorize(m, "leads.read", { orgId: "org1", teamId: "teamB" });
    expect(other).toMatchObject({ allowed: false, reason: "out_of_scope" });
  });

  it("limits an Agent to own records", () => {
    const a = userWith("agent");
    expect(authorize(a, "calls.read", { orgId: "org1", teamId: "teamA", ownerUserId: "u1" }).allowed).toBe(true);
    expect(authorize(a, "calls.read", { orgId: "org1", teamId: "teamA", ownerUserId: "u2" }).allowed).toBe(false);
  });

  it("never crosses orgs for tenant roles", () => {
    const admin = userWith("org_admin");
    expect(authorize(admin, "leads.read", { orgId: "org2" })).toMatchObject({ allowed: false, reason: "cross_org" });
  });

  it("gives Viewer aggregates only, never record reads or recordings", () => {
    const v = userWith("viewer");
    expect(authorize(v, "calls.read")).toMatchObject({ allowed: true, scope: "aggregate" });
    expect(authorize(v, "calls.read", { orgId: "org1", teamId: "teamA" }).allowed).toBe(false);
    expect(authorize(v, "recordings.play", { orgId: "org1", teamId: "teamA" }).allowed).toBe(false);
    expect(authorize(v, "leads.pii.read").allowed).toBe(false);
  });

  it("lets Manager play but not download recordings, and flags both for audit", () => {
    const m = userWith("manager");
    const res = { orgId: "org1", teamId: "teamA" };
    expect(authorize(m, "recordings.play", res)).toMatchObject({ allowed: true, audit: true });
    expect(authorize(m, "recordings.download", res).allowed).toBe(false);
  });

  it("requires a break-glass reason for platform admins on other orgs' recordings", () => {
    const sa = userWith("super_admin", { orgId: "platform" });
    const res = { orgId: "org1" };
    expect(authorize(sa, "recordings.play", res)).toMatchObject({ allowed: false, reason: "break_glass_required" });
    expect(authorize(sa, "recordings.play", res, { breakGlassReason: "ticket #123" })).toMatchObject({
      allowed: true,
      audit: true,
    });
    expect(authorize(sa, "leads.read", res).allowed).toBe(true);
  });

  it("resolves the widest scope held", () => {
    expect(resolveScope(userWith("org_admin"), "leads.read")).toBe("all");
    expect(resolveScope(userWith("manager"), "leads.read")).toBe("team");
    expect(resolveScope(userWith("agent"), "leads.read")).toBe("own");
    expect(resolveScope(userWith("viewer"), "leads.read")).toBeNull();
  });
});
