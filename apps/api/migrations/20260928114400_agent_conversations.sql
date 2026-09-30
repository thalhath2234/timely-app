-- +goose Up
CREATE TABLE agent_conversations (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL,
 status text NOT NULL DEFAULT 'idle',
 phase text NOT NULL DEFAULT 'plan',
 web_search boolean NOT NULL DEFAULT false,
 context jsonb NOT NULL DEFAULT '[]',
 messages jsonb NOT NULL DEFAULT '[]',
 plan jsonb NOT NULL DEFAULT '[]',
 snapshots jsonb NOT NULL DEFAULT '[]',
 transcript jsonb NOT NULL DEFAULT '[]',
 force_review boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0,
 unread boolean NOT NULL DEFAULT false,
 error text NOT NULL DEFAULT '',
 lease text NOT NULL DEFAULT '',
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_conversations_user ON agent_conversations(user_id, updated_at DESC);
CREATE INDEX agent_conversations_pending ON agent_conversations(status, lease_until);
-- +goose Down
DROP TABLE agent_conversations;
