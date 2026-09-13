-- +goose Up
UPDATE users SET email = lower(btrim(email)) WHERE email IS DISTINCT FROM lower(btrim(email));

UPDATE tasks
SET priority_level = CASE lower(btrim(priority_level))
    WHEN 'critical' THEN 'Urgent'
    WHEN 'urgent' THEN 'Urgent'
    WHEN 'high' THEN 'High'
    WHEN 'medium' THEN 'Medium'
    WHEN 'low' THEN 'Low'
    ELSE priority_level
END
WHERE priority_level IS NOT NULL AND btrim(priority_level) <> '';

UPDATE projects
SET priority_level = CASE lower(btrim(priority_level))
    WHEN 'critical' THEN 'Urgent'
    WHEN 'urgent' THEN 'Urgent'
    WHEN 'high' THEN 'High'
    WHEN 'medium' THEN 'Medium'
    WHEN 'low' THEN 'Low'
    ELSE priority_level
END
WHERE priority_level IS NOT NULL AND btrim(priority_level) <> '';

-- Legacy schedules.schedule_id is no longer written by the API. The column
-- remains until a later migration confirms no stored references remain.

-- +goose Down
SELECT 1;
