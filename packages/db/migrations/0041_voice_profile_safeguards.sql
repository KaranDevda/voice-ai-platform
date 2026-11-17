ALTER TABLE "voice_profiles" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD COLUMN "is_cloned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_profiles_org_slug_uq" ON "voice_profiles" USING btree ("org_id","slug") WHERE "slug" is not null;--> statement-breakpoint
UPDATE "voice_profiles" SET "is_cloned" = true WHERE "provider_voice_id" NOT LIKE 'demo-voice-%';
