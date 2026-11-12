-- +goose Up
-- Set on every chat of an account when a backup restore replaced its agent
-- home: the restored state.db holds the backup's transcripts, not the turns
-- since, so the chat's next agent run reseeds the session from its own
-- messages. Cleared when that run starts.
ALTER TABLE agent_conversations ADD COLUMN agent_reseed boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS agent_reseed;
