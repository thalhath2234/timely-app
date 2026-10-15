-- +goose Up
-- Doc suggestions the person dismissed, so a line they said is not a task
-- (or a project, page, type or property they turned down) is not offered
-- again each time the doc opens, on any device.
CREATE TABLE doc_hint_dismissals (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    hint TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_id, hint)
);

-- +goose Down
DROP TABLE IF EXISTS doc_hint_dismissals;
