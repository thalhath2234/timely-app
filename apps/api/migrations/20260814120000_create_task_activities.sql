-- +goose Up
CREATE TABLE IF NOT EXISTS task_activities (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_activities_task_id ON task_activities(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activities_created_at ON task_activities(task_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS task_activities;
