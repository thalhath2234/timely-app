-- +goose Up
-- Smart suggestions (Jev, ADR 0012). decisions_off is the account's switch
-- (suggestions are on once a TypeSafe or OpenRouter key exists);
-- typesafe_rejected marks a saved TypeSafe key that TypeSafe refused.
ALTER TABLE agent_provider_settings
    ADD COLUMN IF NOT EXISTS decisions_off BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS typesafe_rejected BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per Jev call, for tuning thresholds. No task or document text.
-- Rows older than 30 days are pruned.
CREATE TABLE IF NOT EXISTS decision_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    ok BOOLEAN NOT NULL DEFAULT FALSE,
    accepted BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS decision_log_created_at_idx ON decision_log (created_at);
CREATE INDEX IF NOT EXISTS decision_log_user_feature_idx ON decision_log (user_id, feature);

-- +goose Down
DROP TABLE IF EXISTS decision_log;
ALTER TABLE agent_provider_settings
    DROP COLUMN IF EXISTS decisions_off,
    DROP COLUMN IF EXISTS typesafe_rejected;
