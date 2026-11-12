-- +goose Up
-- The account's web search key (Q-3.8): when set, the agent's web search and
-- page reads use this backend instead of the chat provider's own search.
-- api_key is sealed like agent_api_keys; key_hint is what Settings shows.
-- Keys are not backed up (like MCP sign-ins).
CREATE TABLE agent_web_keys (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    backend text NOT NULL,
    api_key text NOT NULL,
    key_hint text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS agent_web_keys;
