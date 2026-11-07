-- +goose Up
-- The Bots board (branch 3): when a watch last changed ("No change in 6
-- days"), the outside app's key name a Bot was made with ("From Claude
-- Code"), and an index for the header's "checks today".
ALTER TABLE bot_watches ADD COLUMN last_changed_at TIMESTAMPTZ;           -- set by a check whose reading changed, or a baseline
ALTER TABLE bots ADD COLUMN origin_client TEXT NOT NULL DEFAULT ''
    CHECK (char_length(origin_client) <= 60);                             -- the API key's name for origin=mcp, else ''
CREATE INDEX bot_checks_user_idx ON bot_checks (user_id, started_at DESC);

-- +goose Down
DROP INDEX IF EXISTS bot_checks_user_idx;
ALTER TABLE bots DROP COLUMN IF EXISTS origin_client;
ALTER TABLE bot_watches DROP COLUMN IF EXISTS last_changed_at;
