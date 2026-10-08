-- +goose Up
-- A model picked in the chat menu for this conversation; empty follows the
-- account default in Settings → Agent.
ALTER TABLE agent_conversations ADD COLUMN chosen_provider text NOT NULL DEFAULT '';
ALTER TABLE agent_conversations ADD COLUMN chosen_model text NOT NULL DEFAULT '';
-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN chosen_model;
ALTER TABLE agent_conversations DROP COLUMN chosen_provider;
