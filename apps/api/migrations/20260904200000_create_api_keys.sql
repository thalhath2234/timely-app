-- +goose Up
-- Personal API keys used by Hermes (and other MCP clients) as Bearer tokens.
-- The raw key is never stored; only a SHA-256 hex digest lives in `hash`.

CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    last_used_at TEXT,
    revoked_at TEXT,
    created_at TEXT
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);

-- +goose Down
DROP TABLE IF EXISTS api_keys;
