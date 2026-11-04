ALTER TABLE "organizations" ADD COLUMN "kyc_tier" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_kyc_tier_chk" CHECK ("kyc_tier" IN ('unverified','basic','business'));--> statement-breakpoint
CREATE TABLE "kyc_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"legal_name" text NOT NULL,
	"pan" text NOT NULL,
	"gstin" text,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"address" text NOT NULL,
	"submitted_by" uuid,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_tier_chk" CHECK ("tier" IN ('basic','business')),
	CONSTRAINT "kyc_status_chk" CHECK ("status" IN ('pending','approved','rejected'))
);--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"e164" text NOT NULL,
	"label" text,
	"capabilities" text[] DEFAULT '{voice,sms}'::text[] NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	CONSTRAINT "phone_numbers_status_chk" CHECK ("status" IN ('available','assigned','released'))
);--> statement-breakpoint
CREATE TABLE "number_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"purpose" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"number_id" uuid,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_requests_kind_chk" CHECK ("kind" IN ('local','tollfree')),
	CONSTRAINT "number_requests_status_chk" CHECK ("status" IN ('pending','approved','rejected'))
);--> statement-breakpoint
-- Background jobs report in here so staff can see whether they are alive. Not organisation data.
CREATE TABLE "job_heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok" boolean DEFAULT true NOT NULL,
	"last_error" text,
	"runs" bigint DEFAULT 0 NOT NULL
);--> statement-breakpoint
ALTER TABLE "kyc_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phone_numbers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "number_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "number_requests" ADD CONSTRAINT "number_requests_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "number_requests" ADD CONSTRAINT "number_requests_number_id_fk" FOREIGN KEY ("number_id") REFERENCES "public"."phone_numbers"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_numbers_e164_uq" ON "phone_numbers" USING btree ("e164");--> statement-breakpoint
CREATE INDEX "kyc_submissions_org_idx" ON "kyc_submissions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "number_requests_status_idx" ON "number_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "kyc_submissions" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "phone_numbers" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "number_requests" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- Platform staff see every organisation's rows. Only code that has first checked the "platform.admin" permission sets app.platform.
CREATE POLICY "platform_all" ON "kyc_submissions" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');--> statement-breakpoint
CREATE POLICY "platform_all" ON "phone_numbers" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');--> statement-breakpoint
CREATE POLICY "platform_all" ON "number_requests" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');--> statement-breakpoint
-- Finds a person across organisations by e-mail (users are hidden from other organisations). Call only after checking "platform.admin".
CREATE OR REPLACE FUNCTION platform_find_user(p_email text) RETURNS TABLE (user_id uuid, org_id uuid, org_name text, email text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.org_id, o.name, u.email, u.status::text FROM users u JOIN organizations o ON o.id = u.org_id WHERE lower(u.email) = lower(btrim(p_email)) LIMIT 5
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION worker_heartbeat(p_name text, p_ok boolean, p_error text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO job_heartbeats (name, last_run_at, last_ok, last_error, runs) VALUES (p_name, now(), p_ok, left(p_error, 300), 1)
  ON CONFLICT (name) DO UPDATE SET last_run_at = now(), last_ok = p_ok, last_error = left(p_error, 300), runs = job_heartbeats.runs + 1
$$;
