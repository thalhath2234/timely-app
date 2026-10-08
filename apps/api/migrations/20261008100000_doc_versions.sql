-- +goose Up
-- Earlier states of a doc for version history. A version is saved when an
-- edit starts after a quiet spell, before the assistant changes a doc, and
-- before a restore, so each one is the doc as it stood at that moment.
CREATE TABLE doc_versions (
    id text PRIMARY KEY,
    document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL DEFAULT '',
    content jsonb NOT NULL DEFAULT '{}'::jsonb,
    plain_text text NOT NULL DEFAULT '',
    reason text NOT NULL DEFAULT 'edit',
    edited_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_doc_versions_document ON doc_versions(document_id, created_at DESC);
CREATE INDEX idx_doc_versions_user_id ON doc_versions(user_id);
-- +goose Down
DROP TABLE doc_versions;
