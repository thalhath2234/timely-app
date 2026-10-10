-- +goose Up
-- Smart suggestions for Today and Auto-schedule (Jev, ADR 0012). Traits are
-- read from a task's own words and stored, so Preview, Apply and Undo rank the
-- same way: effort_kind (deep, admin, creative, routine), urgency (0-4, null
-- when unknown) and group_key (tasks sharing a topic or tool). traits_hash is
-- the hash of the words they were read from; a changed task is read again.
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS effort_kind TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS urgency SMALLINT,
    ADD COLUMN IF NOT EXISTS group_key TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS traits_hash TEXT NOT NULL DEFAULT '';

-- What suggestions may weigh: up to five goals in the person's words and the
-- time of day they prefer for deep work ('', morning, afternoon, evening).
ALTER TABLE agent_provider_settings
    ADD COLUMN IF NOT EXISTS decision_goals JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS deep_work_time TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE agent_provider_settings
    DROP COLUMN IF EXISTS decision_goals,
    DROP COLUMN IF EXISTS deep_work_time;
ALTER TABLE tasks
    DROP COLUMN IF EXISTS effort_kind,
    DROP COLUMN IF EXISTS urgency,
    DROP COLUMN IF EXISTS group_key,
    DROP COLUMN IF EXISTS traits_hash;
