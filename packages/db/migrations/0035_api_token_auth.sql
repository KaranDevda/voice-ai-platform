-- Look up a hashed bearer credential before an organisation context exists; expose no hash or secret.
CREATE FUNCTION auth_find_api_token(p_hash text)
RETURNS TABLE (id uuid, org_id uuid, user_id uuid, permissions text[])
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE api_tokens t SET last_used_at = now()
   WHERE t.token_hash = p_hash AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
   RETURNING t.id, t.org_id, t.user_id, t.permissions
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_api_token(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceai_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth_find_api_token(text) TO voiceai_app';
  END IF;
END $$;
