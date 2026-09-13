-- +goose Up
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    content_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, entity_kind, entity_id, chunk_index)
);

CREATE INDEX idx_embeddings_entity ON embeddings (user_id, entity_kind, entity_id);
CREATE INDEX idx_embeddings_embedding_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);

-- +goose Down
DROP INDEX IF EXISTS idx_embeddings_embedding_hnsw;
DROP INDEX IF EXISTS idx_embeddings_entity;
DROP TABLE IF EXISTS embeddings;
