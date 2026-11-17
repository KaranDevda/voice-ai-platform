-- Migrations 0038-0040 wrote their row-level-security policies against settings the app never sets
-- (app.current_org_id, app.current_team_ids), so every query on these tables failed with
-- "unrecognized configuration parameter". The app sets app.org_id (see withOrg); use the same policy as every other table.
-- Team visibility for these tables is enforced by the scoped queries in the application, as elsewhere.
DROP POLICY IF EXISTS app_errors_org_isolation ON app_errors;--> statement-breakpoint
DROP POLICY IF EXISTS app_errors_team_isolation ON app_errors;--> statement-breakpoint
CREATE POLICY org_isolation ON app_errors USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS cron_jobs_org_isolation ON cron_jobs;--> statement-breakpoint
DROP POLICY IF EXISTS cron_jobs_team_isolation ON cron_jobs;--> statement-breakpoint
CREATE POLICY org_isolation ON cron_jobs USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS extra_languages_org_isolation ON extra_languages;--> statement-breakpoint
CREATE POLICY org_isolation ON extra_languages USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS translations_org_isolation ON translations;--> statement-breakpoint
CREATE POLICY org_isolation ON translations USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
