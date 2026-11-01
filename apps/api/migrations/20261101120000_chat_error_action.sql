-- +goose Up
-- What a person can do about a failed chat run: '' (try again), 'settings'
-- (fix the AI provider in Settings → Agent) or 'none' (trying the same
-- request again would fail the same way). Apps hide Try again accordingly.
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS error_action text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS error_action;
