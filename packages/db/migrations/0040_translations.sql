-- Extra languages per org (org-scoped, RLS-enabled)
DROP TABLE IF EXISTS extra_languages;
CREATE TABLE extra_languages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    native_name TEXT NOT NULL,
    rtl BOOLEAN NOT NULL DEFAULT false,
    enabled BOOLEAN NOT NULL DEFAULT true,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX extra_languages_org_code_uq ON extra_languages (org_id, code);
CREATE INDEX extra_languages_org_idx ON extra_languages (org_id);

ALTER TABLE extra_languages ENABLE ROW LEVEL SECURITY;

CREATE POLICY extra_languages_org_isolation ON extra_languages
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

-- Translation overrides per org (org-scoped, RLS-enabled)
DROP TABLE IF EXISTS translations;
CREATE TABLE translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    lang TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX translations_org_lang_key_uq ON translations (org_id, lang, key);
CREATE INDEX translations_org_lang_idx ON translations (org_id, lang);

ALTER TABLE translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY translations_org_isolation ON translations
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);