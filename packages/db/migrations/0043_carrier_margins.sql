-- What the carrier charges the platform for one country, and the profit margin (percent on top of cost) the platform wants there.
-- Staff apply these to an organisation's country prices; profit reports use the country's cost where there is one, else the
-- platform-wide cost in platform_settings. Platform-level data (no organisation), like platform_settings.
CREATE TABLE "carrier_costs" (
	"country" text PRIMARY KEY NOT NULL,
	"call_cost_per_min_paise" integer NOT NULL,
	"sms_cost_paise" integer NOT NULL,
	"margin_pct" numeric(6,2) NOT NULL DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_costs_country_chk" CHECK ("country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "carrier_costs_cost_chk" CHECK ("call_cost_per_min_paise" BETWEEN 0 AND 100000 AND "sms_cost_paise" BETWEEN 0 AND 100000),
	CONSTRAINT "carrier_costs_margin_chk" CHECK ("margin_pct" BETWEEN 0 AND 1000)
);--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "default_margin_pct" numeric(6,2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_margin_chk" CHECK ("default_margin_pct" BETWEEN 0 AND 1000);
