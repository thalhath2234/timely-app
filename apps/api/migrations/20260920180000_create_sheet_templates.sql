-- +goose Up
CREATE TABLE IF NOT EXISTS sheet_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    merges JSONB NOT NULL DEFAULT '[]'::jsonb,
    tabs JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_sheet_id TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sheet_templates_user_id ON sheet_templates(user_id);

-- +goose Down
DROP TABLE IF EXISTS sheet_templates;
