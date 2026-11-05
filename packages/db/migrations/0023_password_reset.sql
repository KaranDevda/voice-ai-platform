-- Password reset and change. The web app has no organisation context at this point, so it goes through this one function. It sets the new password
-- only when the stored password still matches the fingerprint the person's link (or current-password check) was made from, so a reset link works
-- once: after it is used the fingerprint no longer matches. A reset also clears a lockout. Returns the organisation, or nothing when nothing changed.
CREATE FUNCTION auth_set_password(p_user uuid, p_old_fingerprint text, p_new_hash text, p_action text DEFAULT 'password.reset')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  UPDATE users SET password_hash = p_new_hash, failed_login_count = 0, locked_until = NULL
   WHERE id = p_user AND status = 'active' AND left(encode(sha256(convert_to(password_hash, 'UTF8')), 'hex'), 32) = p_old_fingerprint
   RETURNING org_id INTO v_org;
  IF v_org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO audit_logs (org_id, actor_user_id, action, entity, entity_id) VALUES (v_org, p_user, left(p_action, 40), 'users', p_user::text);
  RETURN v_org;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_set_password(uuid, text, text, text) FROM PUBLIC;
