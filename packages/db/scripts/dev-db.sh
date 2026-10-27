#!/usr/bin/env bash
# Rebuilds the LOCAL development database (voiceai_dev) from the migrations and loads demo data.
# DESTRUCTIVE: drops and recreates voiceai_dev. Never point this at anything but a local dev server.
#
# Uses the local Postgres on the default socket. If pgvector is not installed locally, the vector column
# and HNSW index are skipped (the knowledge base still works; it searches by keyword).
set -euo pipefail
cd "$(dirname "$0")/.."

DB=voiceai_dev
APP_ROLE=voiceai_app
OWNER_URL="postgres://$(whoami)@localhost:5432/$DB"
KEY=$(grep '^MFA_ENCRYPTION_KEY=' ../../apps/web/.env.local | cut -d= -f2-)
[ -n "$KEY" ] || { echo "MFA_ENCRYPTION_KEY missing in apps/web/.env.local"; exit 1; }

psql -d postgres -qc "drop database if exists $DB" -c "create database $DB"

if psql -d postgres -Atc "select 1 from pg_available_extensions where name = 'vector'" | grep -q 1; then
  echo "pgvector found: applying migrations as written"
  cat migrations/0*.sql | sed 's/--> statement-breakpoint//' | psql -v ON_ERROR_STOP=1 -q -d "$DB"
else
  echo "pgvector not installed: skipping the vector column and HNSW index (local development only)"
  cat migrations/0*.sql | sed -e '/CREATE EXTENSION/d' -e '/hnsw/d' -e 's/vector(1536)/text/' -e 's/--> statement-breakpoint//' | psql -v ON_ERROR_STOP=1 -q -d "$DB"
fi

# The app connects as a non-owner role so Postgres row-level security applies, exactly as in production.
psql -d postgres -qc "drop role if exists $APP_ROLE" 2>/dev/null || true
psql -d postgres -qc "create role $APP_ROLE login password 'app'"
psql -d "$DB" -qc "grant all on all tables in schema public to $APP_ROLE" -c "grant execute on function auth_find_user(text) to $APP_ROLE" -c "grant execute on function auth_claim_pairing_code(text) to $APP_ROLE" -c "grant execute on function auth_find_device(text) to $APP_ROLE" -c "grant execute on function worker_pending_analysis(integer), worker_expired_recordings(integer), worker_expired_transcripts(integer) to $APP_ROLE"

DATABASE_URL="$OWNER_URL" MFA_ENCRYPTION_KEY="$KEY" pnpm exec tsx src/seed-demo.ts
echo "Done. Make sure apps/web/.env.local has DATABASE_URL=postgres://$APP_ROLE:app@localhost:5432/$DB"
