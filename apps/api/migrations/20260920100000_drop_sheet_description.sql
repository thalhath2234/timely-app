-- +goose Up
ALTER TABLE sheets DROP COLUMN IF EXISTS description_rich;
ALTER TABLE sheets DROP COLUMN IF EXISTS description;

-- +goose Down
ALTER TABLE sheets ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE sheets ADD COLUMN IF NOT EXISTS description_rich JSONB NOT NULL DEFAULT '{}'::jsonb;
