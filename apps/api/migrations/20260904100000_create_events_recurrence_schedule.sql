-- +goose Up
-- Calendar events are one-off by default. Recurrence is an optional rule that
-- can be attached to either an event or a task (owner_type/owner_id). Scheduled
-- blocks replace the single tasks.scheduled_on as the unit of calendar time.

CREATE TABLE events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN NOT NULL DEFAULT FALSE,
    color TEXT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_start_at ON events(start_at);

-- One rule per owner. The RRULE string is RFC 5545 (FREQ, INTERVAL, COUNT,
-- UNTIL, BYDAY, BYMONTHDAY, BYMONTH). dtstart is the first occurrence and
-- carries the time of day; timezone is the IANA zone occurrences are expanded in.
CREATE TABLE recurrence_rules (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rrule TEXT NOT NULL,
    dtstart TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TEXT,
    updated_at TEXT,
    UNIQUE (owner_type, owner_id)
);

CREATE INDEX idx_recurrence_rules_user_id ON recurrence_rules(user_id);

-- Cancelled / moved / (for tasks) completed instances of a series.
CREATE TABLE recurrence_exceptions (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES recurrence_rules(id) ON DELETE CASCADE,
    original_start TIMESTAMPTZ NOT NULL,
    new_start TIMESTAMPTZ,
    new_end TIMESTAMPTZ,
    is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    created_at TEXT,
    updated_at TEXT,
    UNIQUE (rule_id, original_start)
);

CREATE INDEX idx_recurrence_exceptions_rule_id ON recurrence_exceptions(rule_id);

-- A task can occupy many blocks (chunks). source tells the engine what it may
-- move: 'engine' blocks are rebuilt on reschedule, 'manual' blocks are pinned.
CREATE TABLE scheduled_blocks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    chunk_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX idx_scheduled_blocks_task_id ON scheduled_blocks(task_id);
CREATE INDEX idx_scheduled_blocks_user_start ON scheduled_blocks(user_id, start_at);

-- Weekly availability template used by the scheduling engine.
ALTER TABLE configs ADD COLUMN working_hours JSONB NOT NULL DEFAULT '{}';

-- Tasks already placed on the calendar become a single manual block so nothing
-- disappears when the calendar switches to reading blocks.
INSERT INTO scheduled_blocks (id, task_id, user_id, start_at, end_at, source, chunk_index, created_at, updated_at)
SELECT
    'blk_' || gen_random_uuid()::text,
    t.id,
    t.user_id,
    t.scheduled_on,
    t.scheduled_on + make_interval(mins => GREATEST(COALESCE(t.duration, 0), 15)),
    'manual',
    0,
    to_char(now(), 'YYYY-MM-DD'),
    to_char(now(), 'YYYY-MM-DD')
FROM tasks t
WHERE t.scheduled_on IS NOT NULL AND t.user_id IS NOT NULL;

-- +goose Down
ALTER TABLE configs DROP COLUMN IF EXISTS working_hours;
DROP TABLE IF EXISTS scheduled_blocks;
DROP TABLE IF EXISTS recurrence_exceptions;
DROP TABLE IF EXISTS recurrence_rules;
DROP TABLE IF EXISTS events;
