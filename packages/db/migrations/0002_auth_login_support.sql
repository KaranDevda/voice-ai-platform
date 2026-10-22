ALTER TABLE "users" ADD COLUMN "mfa_last_step" bigint;--> statement-breakpoint
-- Login must find a user by email before the org is known, which RLS on users would block.
-- This SECURITY DEFINER function is the only such door; it exposes just the columns login needs.
-- Emails are stored lowercase. Execute is revoked from PUBLIC: GRANT it to the application role at deploy time.
CREATE OR REPLACE FUNCTION auth_find_user(p_email text)
RETURNS TABLE (
  id uuid, org_id uuid, team_id uuid, password_hash text, mfa_secret_enc text, mfa_last_step bigint,
  status user_status, failed_login_count integer, locked_until timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.org_id, u.team_id, u.password_hash, u.mfa_secret_enc, u.mfa_last_step,
         u.status, u.failed_login_count, u.locked_until
  FROM users u WHERE u.email = lower(p_email)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_user(text) FROM PUBLIC;
