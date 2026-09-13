-- +goose Up
ALTER TABLE configs
    ADD COLUMN IF NOT EXISTS project_task_views JSONB NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE configs
    DROP COLUMN IF EXISTS project_task_views;
