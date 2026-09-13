-- +goose Up
ALTER TABLE configs
    ADD COLUMN IF NOT EXISTS notification_settings jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS jobs (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    dedupe_key text,
    payload jsonb NOT NULL DEFAULT '{}',
    run_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 8,
    last_error text,
    locked_at timestamptz,
    locked_by text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT jobs_status_check CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (status, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs (user_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe_active
    ON jobs (dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    entity_type text,
    entity_id text,
    data jsonb NOT NULL DEFAULT '{}',
    dedupe_key text,
    read_at timestamptz,
    snoozed_until timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
    ON notifications (dedupe_key)
    WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_devices (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    token text NOT NULL,
    platform text NOT NULL DEFAULT 'android',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_token ON push_devices (token);
CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices (user_id);

-- +goose Down
DROP TABLE IF EXISTS push_devices;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS jobs;
ALTER TABLE configs DROP COLUMN IF EXISTS notification_settings;
