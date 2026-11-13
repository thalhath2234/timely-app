-- +goose Up
-- Phase 5 (plan 8.2, Q-5.6): the external MCP servers an account added, each
-- Can use / Ask me first / Off. A new server starts as 'ask'. approved_hash
-- is the hash of a stdio entry the person approved on a host card; an
-- edited entry has a different hash and needs a new card.
CREATE TABLE agent_mcp_servers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    source text NOT NULL DEFAULT 'custom' CHECK (source IN ('catalog', 'custom')),
    catalog_id text NOT NULL DEFAULT '',
    entry jsonb NOT NULL DEFAULT '{}'::jsonb,
    mode text NOT NULL DEFAULT 'ask' CHECK (mode IN ('use', 'ask', 'off')),
    approved_hash text NOT NULL DEFAULT '',
    last_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

-- +goose Down
DROP TABLE IF EXISTS agent_mcp_servers;
