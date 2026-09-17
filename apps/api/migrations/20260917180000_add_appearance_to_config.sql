-- +goose Up
ALTER TABLE configs
    ADD COLUMN IF NOT EXISTS appearance JSONB NOT NULL DEFAULT '{"theme":"system","accent":"default"}';

-- +goose Down
ALTER TABLE configs
    DROP COLUMN IF EXISTS appearance;
