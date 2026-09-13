-- +goose Up
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'task',
    ADD COLUMN IF NOT EXISTS parent_task_id text,
    ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS actual_minutes integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS focus_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS today_focus_on date;

UPDATE tasks SET kind = 'reminder' WHERE duration <= 0 AND kind IS DISTINCT FROM 'inbox';
UPDATE tasks SET kind = 'task' WHERE duration > 0 AND (kind IS NULL OR kind = '');

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('task', 'reminder', 'inbox'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_parent_task_id_fkey;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_parent_task_id_fkey
    FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks (parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_kind ON tasks (user_id, kind);
CREATE INDEX IF NOT EXISTS idx_tasks_user_today_focus ON tasks (user_id, today_focus_on);

-- +goose Down
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_parent_task_id_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
DROP INDEX IF EXISTS idx_tasks_parent_task_id;
DROP INDEX IF EXISTS idx_tasks_user_kind;
DROP INDEX IF EXISTS idx_tasks_user_today_focus;
ALTER TABLE tasks
    DROP COLUMN IF EXISTS today_focus_on,
    DROP COLUMN IF EXISTS focus_started_at,
    DROP COLUMN IF EXISTS actual_minutes,
    DROP COLUMN IF EXISTS checklist,
    DROP COLUMN IF EXISTS parent_task_id,
    DROP COLUMN IF EXISTS kind;
