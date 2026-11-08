-- +goose Up
-- How long a Bot missed checks while Timely was closed, the computer slept or
-- Pause all was on: set by the sweep (or by turning Pause all off) for an
-- active Bot at least 30 minutes late, read and cleared by its next check
-- that reads something, which records it and puts "Paused for 9 hours while
-- Timely was closed" in any alert it raises.
ALTER TABLE bots
    ADD COLUMN away_since TIMESTAMPTZ,
    ADD COLUMN away_until TIMESTAMPTZ,
    ADD COLUMN away_reason TEXT CHECK (away_reason IN ('closed', 'asleep', 'all_paused')),
    ADD CONSTRAINT bots_away_check CHECK ((away_since IS NULL) = (away_reason IS NULL) AND (away_since IS NULL) = (away_until IS NULL));
ALTER TABLE bot_checks
    ADD COLUMN away_secs INTEGER CHECK (away_secs IS NULL OR away_secs > 0),
    ADD COLUMN away_reason TEXT CHECK (away_reason IN ('closed', 'asleep', 'all_paused')),
    ADD CONSTRAINT bot_checks_away_check CHECK ((away_secs IS NULL) = (away_reason IS NULL));
-- +goose Down
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_away_check, DROP COLUMN away_reason, DROP COLUMN away_secs;
ALTER TABLE bots DROP CONSTRAINT bots_away_check, DROP COLUMN away_reason, DROP COLUMN away_until, DROP COLUMN away_since;
