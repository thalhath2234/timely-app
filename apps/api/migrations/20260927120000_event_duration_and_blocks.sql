-- +goose Up
-- Timed Events store duration on the Event and occupy scheduled_blocks
-- (Placement is the writer). All-day Events fill Working hours as Manual blocks.

ALTER TABLE events ADD COLUMN duration INTEGER NOT NULL DEFAULT 0;

UPDATE events
SET duration = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_at - start_at)) / 60.0)::integer)
WHERE all_day = FALSE AND duration = 0;

ALTER TABLE scheduled_blocks ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE scheduled_blocks ADD COLUMN event_id TEXT REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE scheduled_blocks ADD CONSTRAINT scheduled_blocks_owner CHECK (
    (task_id IS NOT NULL AND event_id IS NULL) OR (task_id IS NULL AND event_id IS NOT NULL)
);

CREATE INDEX idx_scheduled_blocks_event_id ON scheduled_blocks(event_id);

-- One-off timed events get a Manual block matching start/end.
INSERT INTO scheduled_blocks (id, task_id, event_id, user_id, start_at, end_at, source, chunk_index, created_at, updated_at)
SELECT
    'blk_' || substr(md5(e.id || e.start_at::text), 1, 16),
    NULL,
    e.id,
    e.user_id,
    e.start_at,
    e.end_at,
    'manual',
    0,
    e.created_at,
    e.updated_at
FROM events e
WHERE e.all_day = FALSE
  AND NOT EXISTS (SELECT 1 FROM recurrence_rules r WHERE r.owner_type = 'event' AND r.owner_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM scheduled_blocks b WHERE b.event_id = e.id);

-- +goose Down
DELETE FROM scheduled_blocks WHERE event_id IS NOT NULL;
DROP INDEX IF EXISTS idx_scheduled_blocks_event_id;
ALTER TABLE scheduled_blocks DROP CONSTRAINT IF EXISTS scheduled_blocks_owner;
ALTER TABLE scheduled_blocks DROP COLUMN IF EXISTS event_id;
ALTER TABLE scheduled_blocks ALTER COLUMN task_id SET NOT NULL;
ALTER TABLE events DROP COLUMN IF EXISTS duration;
