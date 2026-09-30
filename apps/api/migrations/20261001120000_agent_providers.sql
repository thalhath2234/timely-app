-- +goose Up
CREATE TABLE agent_provider_settings (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 default_provider text NOT NULL DEFAULT 'openrouter',
 openrouter_key text NOT NULL DEFAULT '',
 openrouter_key_hint text NOT NULL DEFAULT '',
 openrouter_chat_model text NOT NULL DEFAULT '',
 openrouter_embed_model text NOT NULL DEFAULT '',
 claude_model text NOT NULL DEFAULT '',
 claude_connected_at timestamptz,
 codex_model text NOT NULL DEFAULT '',
 codex_connected_at timestamptz,
 reindex jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_conversations ADD COLUMN provider text NOT NULL DEFAULT '';
ALTER TABLE agent_conversations ADD COLUMN model text NOT NULL DEFAULT '';
-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN model;
ALTER TABLE agent_conversations DROP COLUMN provider;
DROP TABLE agent_provider_settings;
