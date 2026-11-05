-- Website voice widget: an organisation lets a button on its own web pages talk to its AI agent. Each widget has a public key and the
-- list of sites (origins) allowed to use it; the call runs with the permissions of the person who made the widget.
CREATE TABLE "widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"origins" text[] NOT NULL,
	"language" text DEFAULT 'en-hi' NOT NULL,
	"voice" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "widgets_key_uq" UNIQUE("key"),
	CONSTRAINT "widgets_language_chk" CHECK ("language" IN ('en','hi','en-hi')),
	CONSTRAINT "widgets_origins_chk" CHECK (cardinality("origins") BETWEEN 1 AND 10)
);--> statement-breakpoint
ALTER TABLE "widgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "widgets_org_idx" ON "widgets" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "widgets" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- A visitor's browser has no organisation context: the public key finds the widget (and nothing else) through this function.
CREATE FUNCTION widget_find(p_key text)
RETURNS TABLE (id uuid, org_id uuid, created_by uuid, origins text[], language text, voice text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.org_id, w.created_by, w.origins, w.language, w.voice, w.active FROM widgets w WHERE w.key = p_key
$$;
