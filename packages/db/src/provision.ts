import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

/**
 * One-off set-up of a new database (staging), run as a job with the owner login: applies the migrations, then creates or updates
 * the non-owner application role (so row-level security applies to the app) and gives it the table and function access it needs.
 * Safe to run again. Owner login comes from DATABASE_URL, or from DB_HOST / DB_USER / DB_PASSWORD / DB_NAME (as RDS gives them).
 * The role's password is APP_DB_PASSWORD.
 */
const owner = process.env.DATABASE_URL
  ?? (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD
    ? `postgres://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}/${process.env.DB_NAME ?? "voiceai"}?sslmode=no-verify`
    : undefined);
const appPassword = process.env.APP_DB_PASSWORD;
if (!owner) throw new Error("Set DATABASE_URL, or DB_HOST, DB_USER and DB_PASSWORD");
if (!appPassword) throw new Error("APP_DB_PASSWORD is required");

const { db, pool } = createDb(owner);
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
console.log("migrations applied");

const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
await pool.query(`DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'voiceai_app') THEN CREATE ROLE voiceai_app LOGIN; END IF;
END $$`);
await pool.query(`ALTER ROLE voiceai_app PASSWORD ${literal(appPassword)}`);
await pool.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO voiceai_app`);
await pool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO voiceai_app`);
await pool.query(`GRANT EXECUTE ON FUNCTION auth_find_user(text), auth_claim_pairing_code(text), auth_find_device(text), auth_find_api_token(text), worker_pending_analysis(integer), worker_expired_recordings(integer), worker_expired_transcripts(integer) TO voiceai_app`);
await pool.end();
console.log("application role ready");
