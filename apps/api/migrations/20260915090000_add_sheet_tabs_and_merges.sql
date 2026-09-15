-- +goose Up
ALTER TABLE sheets
    ADD COLUMN IF NOT EXISTS merges JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS tabs JSONB NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE sheets
    DROP COLUMN IF EXISTS tabs,
    DROP COLUMN IF EXISTS merges;
