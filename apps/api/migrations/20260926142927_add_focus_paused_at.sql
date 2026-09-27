-- +goose Up
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS focus_paused_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tasks_user_focus_paused ON tasks (user_id, focus_paused_at)
    WHERE focus_paused_at IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_tasks_user_focus_paused;
ALTER TABLE tasks DROP COLUMN IF EXISTS focus_paused_at;
