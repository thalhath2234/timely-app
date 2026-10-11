-- +goose Up
-- Saved task views for the phone app, kept apart from the web and desktop
-- views so each screen keeps its own layouts (the phone shows list and board
-- only). Empty until the phone uploads its device-local views once.
ALTER TABLE configs
    ADD COLUMN IF NOT EXISTS mobile_task_views JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS mobile_active_task_view_id TEXT NOT NULL DEFAULT '';

-- The client ("phone" or "web") of the latest chat message: the agent's view
-- tools act on that client's saved views.
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS client text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS client;
ALTER TABLE configs
    DROP COLUMN IF EXISTS mobile_task_views,
    DROP COLUMN IF EXISTS mobile_active_task_view_id;
