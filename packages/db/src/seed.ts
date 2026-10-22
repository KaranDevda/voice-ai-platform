import { ROLE_KEYS, ROLE_PERMISSIONS } from "@voiceai/auth";
import { createDb } from "./client";
import { roles } from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const { db, pool } = createDb(url);

// System roles (org_id null), idempotent on (org_id, key).
for (const key of ROLE_KEYS) {
  await db
    .insert(roles)
    .values({ key, name: key.replace(/_/g, " "), permissions: [...ROLE_PERMISSIONS[key]] })
    .onConflictDoUpdate({ target: [roles.orgId, roles.key], set: { permissions: [...ROLE_PERMISSIONS[key]] } });
}

await pool.end();
console.log(`seeded ${ROLE_KEYS.length} system roles`);
