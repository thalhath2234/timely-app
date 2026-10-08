-- +goose Up
-- One row per stretch of focused work: written whenever pausing, stopping or
-- completing a focused task adds minutes to tasks.actual_minutes. The task
-- name is a snapshot so the Dashboard's focus time still shows sessions of
-- deleted tasks (task_id becomes NULL then).
CREATE TABLE focus_sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id text REFERENCES tasks(id) ON DELETE SET NULL,
    task_name text NOT NULL DEFAULT '',
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    minutes integer NOT NULL
);
CREATE INDEX idx_focus_sessions_user_ended_at ON focus_sessions(user_id, ended_at);
-- +goose Down
DROP TABLE focus_sessions;
