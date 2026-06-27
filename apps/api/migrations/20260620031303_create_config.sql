-- +goose Up
CREATE TABLE IF NOT EXISTS configs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_on_boarding_completed BOOLEAN DEFAULT FALSE,
    created_at TEXT,
    updated_at TEXT
);

-- +goose Down
DROP TABLE IF EXISTS configs;
