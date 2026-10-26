#!/usr/bin/env bash
# Applies the real migrations (including pgvector and HNSW) as the owner, then creates the non-owner
# application role the integration tests use so RLS actually applies. Expects PG* env vars.
set -euo pipefail
cd "$(dirname "$0")/.."

DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}" pnpm migrate

psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE voiceai_app LOGIN PASSWORD 'app';
GRANT ALL ON ALL TABLES IN SCHEMA public TO voiceai_app;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO voiceai_app;
GRANT EXECUTE ON FUNCTION auth_claim_pairing_code(text) TO voiceai_app;
GRANT EXECUTE ON FUNCTION auth_find_device(text) TO voiceai_app;
SQL
