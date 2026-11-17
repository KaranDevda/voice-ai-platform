-- Scheduled export jobs (org-scoped, RLS-enabled)
CREATE TABLE IF NOT EXISTS cron_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    team_id UUID REFERENCES teams(id),
    user_id UUID REFERENCES users(id),
    name TEXT NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN ('contacts', 'calls', 'sms')),
    cron TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    email TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    next_run TIMESTAMPTZ,
    last_run TIMESTAMPTZ,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cron_jobs_org_active_idx ON cron_jobs (org_id, active);

ALTER TABLE cron_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY cron_jobs_org_isolation ON cron_jobs
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY cron_jobs_team_isolation ON cron_jobs
    USING (team_id IS NULL OR team_id = ANY(current_setting('app.current_team_ids')::uuid[]))
    WITH CHECK (team_id IS NULL OR team_id = ANY(current_setting('app.current_team_ids')::uuid[]));