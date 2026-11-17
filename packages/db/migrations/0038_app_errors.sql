-- Application error log (org-scoped, RLS-enabled)
CREATE TABLE IF NOT EXISTS app_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    team_id UUID REFERENCES teams(id),
    user_id UUID REFERENCES users(id),
    route TEXT NOT NULL,
    method TEXT,
    error_message TEXT NOT NULL,
    error_stack TEXT,
    request_body JSONB,
    request_headers JSONB,
    user_agent TEXT,
    ip INET,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_errors_org_at_idx ON app_errors (org_id, at DESC);
CREATE INDEX IF NOT EXISTS app_errors_route_idx ON app_errors (route);

ALTER TABLE app_errors ENABLE ROW LEVEL SECURITY;

-- Org isolation: users can only see errors from their own org
CREATE POLICY app_errors_org_isolation ON app_errors
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

-- Team scope for team-level roles
CREATE POLICY app_errors_team_isolation ON app_errors
    USING (team_id IS NULL OR team_id = ANY(current_setting('app.current_team_ids')::uuid[]))
    WITH CHECK (team_id IS NULL OR team_id = ANY(current_setting('app.current_team_ids')::uuid[]));