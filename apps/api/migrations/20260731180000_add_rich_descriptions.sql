-- +goose Up
-- Rich descriptions are stored alongside the existing plain-text `description`
-- column, which stays authoritative for search, list views and exports.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description_rich JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description_rich JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sheets ADD COLUMN IF NOT EXISTS description_rich JSONB NOT NULL DEFAULT '{}'::jsonb;

-- +goose Down
ALTER TABLE tasks DROP COLUMN IF EXISTS description_rich;
ALTER TABLE projects DROP COLUMN IF EXISTS description_rich;
ALTER TABLE sheets DROP COLUMN IF EXISTS description_rich;
