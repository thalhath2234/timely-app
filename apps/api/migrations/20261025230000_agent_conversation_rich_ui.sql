-- +goose Up
-- Whether the app that sent the latest message draws reply cards (OpenUI);
-- the agent is only told about cards when it does.
ALTER TABLE agent_conversations ADD COLUMN rich_ui boolean NOT NULL DEFAULT false;
-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN rich_ui;
