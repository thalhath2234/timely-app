-- +goose Up
-- Statuses, labels and custom fields had no stored order: they were read with
-- no ORDER BY, so Postgres returned them in heap order and an UPDATE (even one
-- that saved no change) moved the row to the end of the list. created_at holds
-- only a day and ids are random, so neither can order rows made the same day.
-- position records creation order within a workspace.
ALTER TABLE statuses ADD COLUMN IF NOT EXISTS position BIGINT NOT NULL DEFAULT 0;
ALTER TABLE lables ADD COLUMN IF NOT EXISTS position BIGINT NOT NULL DEFAULT 0;
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS position BIGINT NOT NULL DEFAULT 0;

-- Backfill from the best order still known: the creation day, then the order
-- a new workspace creates its default statuses in, then the physical order
-- (which an earlier edit may already have disturbed; nothing better is kept).
UPDATE statuses s SET position = o.n
FROM (
    SELECT id, row_number() OVER (
        PARTITION BY workspace_id
        ORDER BY created_at,
            CASE name
                WHEN 'Backlog' THEN 1
                WHEN 'Todo' THEN 2
                WHEN 'In Progress' THEN 3
                WHEN 'Blocked' THEN 4
                WHEN 'Completed' THEN 5
                WHEN 'Canceled' THEN 6
                ELSE 7
            END,
            ctid
    ) AS n
    FROM statuses
) o
WHERE s.id = o.id;

UPDATE lables l SET position = o.n
FROM (SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, ctid) AS n FROM lables) o
WHERE l.id = o.id;

UPDATE custom_fields f SET position = o.n
FROM (SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, ctid) AS n FROM custom_fields) o
WHERE f.id = o.id;

-- +goose Down
ALTER TABLE custom_fields DROP COLUMN IF EXISTS position;
ALTER TABLE lables DROP COLUMN IF EXISTS position;
ALTER TABLE statuses DROP COLUMN IF EXISTS position;
