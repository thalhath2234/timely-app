-- +goose Up
-- The agent engine is the only chat engine (ADR 0029): the classic loop's
-- transcript, the per-chat engine choice and the run's engine, and the
-- account's Settings → Agent → Engine go. Every plan turn runs on the agent
-- engine; Sensitive and photo chats as no-persist runs.
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS transcript;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS run_engine;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS engine;
ALTER TABLE agent_chat_settings DROP COLUMN IF EXISTS engine;

-- +goose Down
-- The columns come back empty: every chat as an agent chat, every account on
-- the agent engine.
ALTER TABLE agent_chat_settings ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'agent'
    CHECK (engine IN ('classic', 'agent'));
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT ''
    CHECK (engine IN ('', 'classic', 'agent'));
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS run_engine text NOT NULL DEFAULT '';
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS transcript jsonb NOT NULL DEFAULT '[]';
