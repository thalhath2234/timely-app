-- +goose Up
-- Deleted chats whose Hermes session (the worker's state.db) is still to be
-- deleted (plan 5.4): kept until the account's worker acknowledges
-- session.delete, so an API restart or an idle worker doesn't lose it.
CREATE TABLE agent_session_forgets (
    user_id text NOT NULL,
    conversation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, conversation_id)
);

-- +goose Down
DROP TABLE IF EXISTS agent_session_forgets;
