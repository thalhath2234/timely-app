-- +goose Up
-- Why a staged learning change waits for the person (tainted, bot,
-- unattended, skill_body), so the Keep / Discard card gives the real reason.
ALTER TABLE agent_learning_events ADD COLUMN reason text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE agent_learning_events DROP COLUMN IF EXISTS reason;
