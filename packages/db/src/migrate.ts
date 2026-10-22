import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const { db, pool } = createDb(url);
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
await pool.end();
console.log("migrations applied");
