-- +goose Up
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup'));

CREATE TABLE IF NOT EXISTS backup_settings (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    interval_days integer NOT NULL DEFAULT 1 CHECK (interval_days BETWEEN 1 AND 30),
    retention_count integer NOT NULL DEFAULT 7 CHECK (retention_count BETWEEN 1 AND 30),
    next_run_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backup_files (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path text NOT NULL,
    byte_size bigint NOT NULL,
    checksum text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_files_user_created
    ON backup_files (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS backup_files;
DROP TABLE IF EXISTS backup_settings;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push'));
