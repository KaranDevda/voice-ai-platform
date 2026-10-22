import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>["db"];
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` in a transaction with the RLS org context set, so Postgres policies apply
 * as the second wall behind the scoped repositories.
 */
export async function withOrg<T>(db: Db, orgId: string, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
