CREATE TABLE "device_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_pairing_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairing_codes" ADD CONSTRAINT "device_pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_token_hash_uq" UNIQUE("token_hash");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "device_pairing_codes" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- A phone has no session and no organisation yet when it first connects, so RLS would hide everything. Like auth_find_user,
-- these two SECURITY DEFINER functions are the only doors, and each exposes only what it must.
-- Claiming a code is one atomic UPDATE: a code can be used once, and only before it expires.
CREATE OR REPLACE FUNCTION auth_claim_pairing_code(p_hash text)
RETURNS TABLE (org_id uuid, user_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE device_pairing_codes SET used_at = now()
  WHERE code_hash = p_hash AND used_at IS NULL AND expires_at > now()
  RETURNING device_pairing_codes.org_id, device_pairing_codes.user_id
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth_find_device(p_hash text)
RETURNS TABLE (id uuid, org_id uuid, user_id uuid, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.org_id, d.user_id, d.revoked_at FROM devices d WHERE d.token_hash = p_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_claim_pairing_code(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_find_device(text) FROM PUBLIC;
