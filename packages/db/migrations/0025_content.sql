-- Content that platform staff edit without a deploy: translation overrides (and whole extra languages) for the interface, and the text on the sign-in page.
-- Platform-wide, not per organisation, so there is no row-level security; the app checks "platform.admin" before any write.
CREATE TABLE "translations" (
	"lang" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translations_pk" PRIMARY KEY ("lang", "key"),
	CONSTRAINT "translations_len_chk" CHECK (length("value") BETWEEN 1 AND 300 AND length("key") BETWEEN 1 AND 200)
);--> statement-breakpoint
CREATE TABLE "extra_languages" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rtl" boolean DEFAULT false NOT NULL,
	CONSTRAINT "extra_languages_code_chk" CHECK ("code" ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
	CONSTRAINT "extra_languages_name_chk" CHECK (length("name") BETWEEN 1 AND 40)
);--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "landing_headline" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "landing_text" text DEFAULT '' NOT NULL;
