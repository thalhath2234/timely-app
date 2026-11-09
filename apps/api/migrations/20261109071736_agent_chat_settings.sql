-- +goose Up
-- Per-account chat settings (Q-2.2, Q-P1): the engine new runs use (Classic
-- until the person picks New), the permission new chats and bots start with,
-- and where Full Access may be turned on. A missing row reads as the
-- defaults. bot_permission is read from phase 6.
CREATE TABLE agent_chat_settings (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    engine text NOT NULL DEFAULT 'classic' CHECK (engine IN ('classic', 'agent')),
    chat_permission text NOT NULL DEFAULT 'supervised' CHECK (chat_permission IN ('supervised', 'auto', 'full')),
    bot_permission text NOT NULL DEFAULT 'auto' CHECK (bot_permission IN ('supervised', 'auto', 'full')),
    full_access_allowed_on text NOT NULL DEFAULT 'desktop' CHECK (full_access_allowed_on IN ('desktop', 'devices')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS agent_chat_settings;
