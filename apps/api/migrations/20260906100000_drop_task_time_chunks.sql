-- +goose Up
-- Time chunks were a client-only scheduling hint. Incoming JSON still
-- ignores the field so old clients do not 400.
ALTER TABLE tasks DROP COLUMN IF EXISTS time_chunks;

-- +goose Down
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_chunks INTEGER DEFAULT 30;
