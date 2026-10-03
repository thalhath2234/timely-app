-- +goose Up
-- Databases created before ADR 0011 hold embeddings as pgvector's vector(1536).
-- Convert them to real[] so the API no longer needs the extension. The
-- extension itself is left alone: other schemas in a shared database may use it.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'embeddings'
          AND column_name = 'embedding'
          AND udt_name = 'vector'
    ) THEN
        DROP INDEX IF EXISTS idx_embeddings_embedding_hnsw;
        ALTER TABLE embeddings ALTER COLUMN embedding TYPE real[] USING embedding::real[];
    END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'embeddings'
          AND column_name = 'embedding'
          AND udt_name <> 'vector'
    ) THEN
        ALTER TABLE embeddings ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector(1536);
        CREATE INDEX IF NOT EXISTS idx_embeddings_embedding_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);
    END IF;
END
$$;
-- +goose StatementEnd
