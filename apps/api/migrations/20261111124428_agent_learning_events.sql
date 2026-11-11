-- +goose Up
-- What the agent learned, per account (plan 9b.2 item 5, 9b.4): one row per
-- learning event a worker reported (a skill or memory write, applied, staged
-- for the person to keep or discard, or blocked), and what the person did
-- with it (undone, kept, discarded). It is also memory's undo history, since
-- Hermes keeps none: before and after are the entry texts. worker_event_id is
-- the worker's own id, so a repeated message is recorded once.
CREATE TABLE agent_learning_events (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    worker_event_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('skill', 'memory', 'user')),
    action text NOT NULL DEFAULT '',
    subject text NOT NULL DEFAULT '',
    before text NOT NULL DEFAULT '',
    after text NOT NULL DEFAULT '',
    origin text NOT NULL DEFAULT '',
    conversation_id text NOT NULL DEFAULT '',
    run_id text NOT NULL DEFAULT '',
    bot_id text NOT NULL DEFAULT '',
    tainted_sources jsonb NOT NULL DEFAULT '[]',
    status text NOT NULL CHECK (status IN ('applied', 'staged', 'blocked', 'undone', 'kept', 'discarded')),
    ledger_entry_id text NOT NULL DEFAULT '',
    pending_id text NOT NULL DEFAULT '',
    summary text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, worker_event_id)
);
CREATE INDEX agent_learning_events_user_created_idx ON agent_learning_events (user_id, created_at DESC);
CREATE INDEX agent_learning_events_user_conversation_idx ON agent_learning_events (user_id, conversation_id);

-- +goose Down
DROP TABLE IF EXISTS agent_learning_events;
