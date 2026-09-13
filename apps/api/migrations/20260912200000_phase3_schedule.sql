-- +goose Up
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS min_chunk_minutes integer NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS preferred_chunk_minutes integer,
    ADD COLUMN IF NOT EXISTS contiguous boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS earliest_start_at timestamptz,
    ADD COLUMN IF NOT EXISTS preferred_windows jsonb NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS schedule_locked boolean NOT NULL DEFAULT false;

ALTER TABLE scheduled_blocks
    ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS occurrence_start timestamptz;

CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_occurrence
    ON scheduled_blocks (task_id, occurrence_start);

ALTER TABLE configs
    ADD COLUMN IF NOT EXISTS schedule_settings jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS schedule_revisions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    horizon_from timestamptz NOT NULL,
    horizon_to timestamptz NOT NULL,
    snapshot jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_revisions_user
    ON schedule_revisions (user_id, created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS idx_schedule_revisions_user;
DROP TABLE IF EXISTS schedule_revisions;
ALTER TABLE configs DROP COLUMN IF EXISTS schedule_settings;
DROP INDEX IF EXISTS idx_scheduled_blocks_occurrence;
ALTER TABLE scheduled_blocks
    DROP COLUMN IF EXISTS occurrence_start,
    DROP COLUMN IF EXISTS locked;
ALTER TABLE tasks
    DROP COLUMN IF EXISTS schedule_locked,
    DROP COLUMN IF EXISTS preferred_windows,
    DROP COLUMN IF EXISTS earliest_start_at,
    DROP COLUMN IF EXISTS contiguous,
    DROP COLUMN IF EXISTS preferred_chunk_minutes,
    DROP COLUMN IF EXISTS min_chunk_minutes;
