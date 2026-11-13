-- +goose Up
-- Phase 5 (plan 6.4): secrets the agent needs at spawn time, encrypted with
-- the provider-key handling (MCP OAuth tokens first). Never in a backup.
CREATE TABLE agent_secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    name text NOT NULL,
    ciphertext bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, kind, name)
);

-- +goose Down
DROP TABLE IF EXISTS agent_secrets;
