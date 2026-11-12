-- +goose Up
-- When a learning change reached the account home: when it was recorded for
-- an applied change, when the person kept it for a staged one (null while it
-- waits). Undo's "also takes back later changes" is ordered by it, not by
-- when the row was made: a kept change is applied after changes recorded
-- while it waited.
ALTER TABLE agent_learning_events ADD COLUMN applied_at timestamptz;
UPDATE agent_learning_events SET applied_at = CASE WHEN status = 'kept' THEN updated_at ELSE created_at END
WHERE status IN ('applied', 'kept', 'undone');

-- +goose Down
ALTER TABLE agent_learning_events DROP COLUMN IF EXISTS applied_at;
