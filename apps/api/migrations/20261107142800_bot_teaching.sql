-- +goose Up
-- A rules-only Bot whose last three sent alerts were all rated Not useful
-- suggests a better rule, worked out by code (never AI). suggestion holds it
-- until the person applies or dismisses it, or edits what it would change;
-- suggestion_dismissed_at is when they last did, so the same three ratings
-- do not bring it back.
ALTER TABLE bots ADD COLUMN suggestion JSONB,
                 ADD COLUMN suggestion_dismissed_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE bots DROP COLUMN suggestion_dismissed_at, DROP COLUMN suggestion;
