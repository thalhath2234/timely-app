-- +goose Up
-- The device timezone sent with the latest chat message; the agent uses it
-- when the account has no timezone saved in Working hours.
ALTER TABLE agent_conversations ADD COLUMN timezone text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN timezone;
