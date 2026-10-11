-- +goose Up
-- The Report page layout (cards, order, sizes, card settings). NULL means the
-- account has not customised it yet and the clients show their default.
ALTER TABLE configs
    ADD COLUMN IF NOT EXISTS report_dashboard JSONB;

-- +goose Down
ALTER TABLE configs
    DROP COLUMN IF EXISTS report_dashboard;
