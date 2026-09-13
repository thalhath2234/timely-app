-- +goose Up
-- Inbox items and reminders are allowed without a workspace until clarified.
ALTER TABLE tasks ALTER COLUMN workspace_id DROP NOT NULL;

-- +goose Down
UPDATE tasks SET workspace_id = (
    SELECT id FROM workspaces WHERE workspaces.user_id = tasks.user_id ORDER BY created_at LIMIT 1
) WHERE workspace_id IS NULL;
ALTER TABLE tasks ALTER COLUMN workspace_id SET NOT NULL;
