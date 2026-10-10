-- +goose Up
-- Habits and goals on Today (issue #128). Habits are checked off per day and
-- their streaks are counted from habit_checks; goals move from
-- agent_provider_settings.decision_goals to their own table so they work
-- without a smart suggestions key. goal_task_tags caches which goal Jev said
-- an open task moves forward, keyed by hashes of the goals and the task's
-- words, so a page load does not ask again for unchanged Work.
CREATE TABLE habits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX habits_user_idx ON habits (user_id, position);

CREATE TABLE habit_checks (
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (habit_id, day)
);
CREATE INDEX habit_checks_user_day_idx ON habit_checks (user_id, day);

CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX goals_user_idx ON goals (user_id, position);

CREATE TABLE goal_task_tags (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    goals_hash TEXT NOT NULL,
    task_hash TEXT NOT NULL,
    goal_id TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, task_id)
);

-- Each account's saved goals, in order, at most five, blanks skipped and
-- titles clipped to 80 characters. decision_goals is left in place but no
-- longer read or written.
INSERT INTO goals (id, user_id, title, position, created_at, updated_at)
SELECT 'goal_' || gen_random_uuid()::text, s.user_id, left(g.title, 80), g.rn - 1, now(), now()
FROM agent_provider_settings s
JOIN users u ON u.id = s.user_id
CROSS JOIN LATERAL (
    SELECT btrim(regexp_replace(e.value, '\s+', ' ', 'g')) AS title,
           row_number() OVER (ORDER BY e.ord) AS rn
    FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(s.decision_goals) = 'array' THEN s.decision_goals ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(value, ord)
    WHERE btrim(e.value) <> ''
) g
WHERE g.rn <= 5;

-- +goose Down
-- Goals go back to Settings -> Agent, in order, so a rollback keeps them.
UPDATE agent_provider_settings s SET decision_goals = COALESCE((
    SELECT jsonb_agg(g.title ORDER BY g.position, g.id) FROM goals g WHERE g.user_id = s.user_id
), '[]'::jsonb);
DROP TABLE IF EXISTS goal_task_tags;
DROP TABLE IF EXISTS goals;
DROP TABLE IF EXISTS habit_checks;
DROP TABLE IF EXISTS habits;
