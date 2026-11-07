-- +goose Up
-- A brief and the digest leave out notes another Bot took (a pass of the
-- note) and the notes of a check whose alert was held back: these indexes
-- let them look both up per note.
CREATE INDEX bot_passes_finding_idx ON bot_passes (finding_id) WHERE finding_id IS NOT NULL;
CREATE INDEX bot_alerts_check_idx ON bot_alerts (check_id) WHERE check_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS bot_alerts_check_idx;
DROP INDEX IF EXISTS bot_passes_finding_idx;
