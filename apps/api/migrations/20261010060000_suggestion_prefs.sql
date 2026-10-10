-- +goose Up
-- Personalisation (Jev Phase 9): what the person said they use Timely for,
-- and the screen tips they dismissed.
CREATE TABLE suggestion_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    use_case TEXT NOT NULL DEFAULT '',
    dismissed_tips JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS suggestion_prefs;
