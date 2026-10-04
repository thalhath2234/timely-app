-- +goose Up
-- Language of the conversation (BCP 47 primary tag), used for the notices and
-- push texts Timely writes itself. Empty means English.
ALTER TABLE agent_conversations ADD COLUMN language text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN language;
