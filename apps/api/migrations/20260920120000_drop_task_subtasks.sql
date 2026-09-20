-- +goose Up
-- Fold one-level subtasks into the parent's checklist, then drop nesting.

WITH children AS (
    SELECT
        id,
        parent_task_id,
        name,
        CASE
            WHEN completed_at IS NULL THEN NULL
            ELSE to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        END AS completed_at,
        ROW_NUMBER() OVER (PARTITION BY parent_task_id ORDER BY created_at, id) AS rn
    FROM tasks
    WHERE parent_task_id IS NOT NULL AND btrim(parent_task_id) <> ''
)
UPDATE tasks AS parent
SET checklist = COALESCE(parent.checklist, '[]'::jsonb) || COALESCE((
    SELECT jsonb_agg(
        jsonb_strip_nulls(
            jsonb_build_object(
                'id', 'chk_' || substr(md5(child.id), 1, 20),
                'title', child.name,
                'completedAt', child.completed_at,
                'order', jsonb_array_length(COALESCE(parent.checklist, '[]'::jsonb)) + child.rn::int - 1
            )
        )
        ORDER BY child.rn
    )
    FROM children AS child
    WHERE child.parent_task_id = parent.id
), '[]'::jsonb)
WHERE parent.id IN (SELECT DISTINCT parent_task_id FROM children);

DELETE FROM embeddings
WHERE entity_kind = 'task'
  AND entity_id IN (SELECT id FROM tasks WHERE parent_task_id IS NOT NULL);

DELETE FROM recurrence_exceptions
WHERE rule_id IN (
    SELECT id FROM recurrence_rules
    WHERE owner_type = 'task'
      AND owner_id IN (SELECT id FROM tasks WHERE parent_task_id IS NOT NULL)
);

DELETE FROM recurrence_rules
WHERE owner_type = 'task'
  AND owner_id IN (SELECT id FROM tasks WHERE parent_task_id IS NOT NULL);

DELETE FROM tasks WHERE parent_task_id IS NOT NULL;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_parent_task_id_fkey;
DROP INDEX IF EXISTS idx_tasks_parent_task_id;
ALTER TABLE tasks DROP COLUMN IF EXISTS parent_task_id;

-- +goose Down
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id text;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_parent_task_id_fkey;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_parent_task_id_fkey
    FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks (parent_task_id);
