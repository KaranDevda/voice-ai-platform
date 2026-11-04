ALTER TABLE "leads" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;
