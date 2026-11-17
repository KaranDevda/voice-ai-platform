import { describe, expect, it } from "vitest";
import type { AuthUser } from "@voiceai/auth";
import { authenticateApiToken, ApiTokenError, API_TOKEN_PERMISSIONS, createApiToken } from "./api-tokens";
import type { Db } from "./client";

const actor: AuthUser = { id: "u", orgId: "o", teamIds: [], permissions: ["leads.read.own", "calls.place", "platform.admin"] };

describe("API tokens", () => {
  it("offers only valid permissions held by the owner and never grants platform admin", () => {
    expect(API_TOKEN_PERMISSIONS(actor)).toEqual(["leads.read.own", "calls.place"]);
  });

  it("rejects empty, unknown and elevated permission requests before touching the database", async () => {
    const db = {} as Db;
    for (const permissions of [[], ["anything"], ["platform.admin"], ["leads.read.all"]]) {
      await expect(createApiToken(db, actor, { name: "Integration", permissions, expiresInDays: 30 })).rejects.toBeInstanceOf(ApiTokenError);
    }
  });

  it("rejects malformed bearer secrets before making a database lookup", async () => {
    expect(await authenticateApiToken({} as Db, "va_short")).toBeNull();
  });
});
