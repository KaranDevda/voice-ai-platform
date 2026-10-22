CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."call_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."call_source" AS ENUM('ai_inbound', 'ai_outbound', 'web_dialer', 'mobile_sim');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('connected', 'missed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."consent_subject_type" AS ENUM('staff', 'caller');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('android');--> statement-breakpoint
CREATE TYPE "public"."lead_consent_status" AS ENUM('unknown', 'granted', 'denied', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'interested', 'callback_requested', 'not_interested', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."sentiment_label" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TYPE "public"."status_changer" AS ENUM('user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."voice_gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."voice_profile_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"user_id" uuid NOT NULL,
	"platform" "device_platform" DEFAULT 'android' NOT NULL,
	"device_fingerprint" text NOT NULL,
	"work_sim_slot" integer,
	"last_sync_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_user_fingerprint_uq" UNIQUE("user_id","device_fingerprint")
);
--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data_retention_days" integer DEFAULT 365 NOT NULL,
	"recording_retention_days" integer DEFAULT 180 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_org_key_uq" UNIQUE NULLS NOT DISTINCT("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"manager_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_org_name_uq" UNIQUE("org_id","name")
);
--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"mfa_secret_enc" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"subject_type" "consent_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"method" text NOT NULL,
	"document_url" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"label" text NOT NULL,
	"gender" "voice_gender" NOT NULL,
	"provider" text DEFAULT 'elevenlabs' NOT NULL,
	"provider_voice_id" text NOT NULL,
	"donor_user_id" uuid NOT NULL,
	"consent_record_id" uuid NOT NULL,
	"status" "voice_profile_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lead_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"lead_id" uuid NOT NULL,
	"from_status" "lead_status",
	"to_status" "lead_status" NOT NULL,
	"changed_by" "status_changer" NOT NULL,
	"changed_by_user_id" uuid,
	"reason" text,
	"confidence" real,
	"call_log_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"owner_user_id" uuid,
	"name" text,
	"phone_e164" text NOT NULL,
	"email" text,
	"source" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"score" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"dnd_flag" boolean DEFAULT false NOT NULL,
	"consent_status" "lead_consent_status" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_insights" (
	"call_log_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"summary" text NOT NULL,
	"sentiment_score" real NOT NULL,
	"sentiment_label" "sentiment_label" NOT NULL,
	"intent" text,
	"next_action" text,
	"suggested_status" "lead_status",
	"suggested_status_confidence" real,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_insights_sentiment_range" CHECK ("call_insights"."sentiment_score" between -1 and 1),
	CONSTRAINT "call_insights_confidence_range" CHECK ("call_insights"."suggested_status_confidence" is null or "call_insights"."suggested_status_confidence" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "call_insights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"lead_id" uuid,
	"agent_user_id" uuid,
	"voice_profile_id" uuid,
	"direction" "call_direction" NOT NULL,
	"source" "call_source" NOT NULL,
	"status" "call_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_s" integer DEFAULT 0 NOT NULL,
	"provider_call_uuid" text,
	"device_id" uuid,
	"recording_key" text,
	"handoff_to_user_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_transcripts" (
	"call_log_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"segments" jsonb NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_transcripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"ip" text,
	"user_agent" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunks_doc_idx_uq" UNIQUE("document_id","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "kb_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"team_id" uuid,
	"title" text NOT NULL,
	"source_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_provider_event_uq" UNIQUE("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_donor_user_id_users_id_fk" FOREIGN KEY ("donor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_consent_record_id_consent_records_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."consent_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_insights" ADD CONSTRAINT "call_insights_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_insights" ADD CONSTRAINT "call_insights_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_insights" ADD CONSTRAINT "call_insights_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_handoff_to_user_id_users_id_fk" FOREIGN KEY ("handoff_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_org_team_idx" ON "users" USING btree ("org_id","team_id");--> statement-breakpoint
CREATE INDEX "consent_records_subject_idx" ON "consent_records" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_profiles_provider_voice_uq" ON "voice_profiles" USING btree ("provider","provider_voice_id");--> statement-breakpoint
CREATE INDEX "voice_profiles_org_status_idx" ON "voice_profiles" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "lead_status_history_lead_idx" ON "lead_status_history" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_phone_uq" ON "leads" USING btree ("org_id","phone_e164");--> statement-breakpoint
CREATE INDEX "leads_team_idx" ON "leads" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "call_logs_lead_started_idx" ON "call_logs" USING btree ("lead_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "call_logs_agent_started_idx" ON "call_logs" USING btree ("agent_user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_logs_idempotency_uq" ON "call_logs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "call_logs_provider_call_uq" ON "call_logs" USING btree ("provider_call_uuid");--> statement-breakpoint
CREATE INDEX "audit_logs_org_at_idx" ON "audit_logs" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_hnsw" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "devices" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "teams" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "consent_records" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "voice_profiles" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "lead_status_history" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "leads" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "call_insights" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "call_logs" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "call_transcripts" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "audit_logs" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "kb_chunks" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "kb_documents" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);