-- +goose Up
-- Embeddings are plain real[] (ADR 0011): similarity runs in the API, so a
-- fresh database needs no extension.
CREATE TABLE embeddings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    embedding real[] NOT NULL,
    content_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, entity_kind, entity_id, chunk_index)
);

CREATE INDEX idx_embeddings_entity ON embeddings (user_id, entity_kind, entity_id);

-- +goose Down
DROP INDEX IF EXISTS idx_embeddings_entity;
DROP TABLE IF EXISTS embeddings;
