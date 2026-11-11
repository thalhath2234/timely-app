-- +goose Up
-- "Don't learn from this chat" (plan 9b.2): such a chat's runs never write
-- memory or skills and never come back from past-chat search.
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS no_learning boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS no_learning;
