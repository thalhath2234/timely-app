-- +goose Up
-- The skills the person turned on (Settings → Skills). Reviewed bundled
-- skills that are off by default stay off unless their name is listed here
-- (the worker's settings.skills_enabled); skills_disabled still wins.
ALTER TABLE agent_learning_settings ADD COLUMN skills_enabled jsonb NOT NULL DEFAULT '[]';

-- +goose Down
ALTER TABLE agent_learning_settings DROP COLUMN IF EXISTS skills_enabled;
