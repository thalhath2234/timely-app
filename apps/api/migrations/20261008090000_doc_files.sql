-- +goose Up
-- Images people add to docs. The id is a long random string, so the file can
-- be shown with a plain <img src> (which sends no token) without being
-- guessable; GET /files/:id serves it.
CREATE TABLE doc_files (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT '',
    mime text NOT NULL,
    size integer NOT NULL,
    width integer NOT NULL DEFAULT 0,
    height integer NOT NULL DEFAULT 0,
    data bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_doc_files_user_id ON doc_files(user_id);
-- +goose Down
DROP TABLE doc_files;
