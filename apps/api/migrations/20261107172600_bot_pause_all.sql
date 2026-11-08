-- +goose Up
-- "Pause all bots": while bots_paused_at is set, no Bot of the account is
-- checked, no passed item runs and no re-judge asks the AI again. Each Bot
-- keeps its own status, so turning it off again picks up where they were.
ALTER TABLE configs ADD COLUMN bots_paused_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE configs DROP COLUMN bots_paused_at;
