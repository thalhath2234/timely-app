-- +goose Up
-- Phase 5 (plan 5.5, decision 16): every host action has a matching event.
-- kind: requested, approved (choice, device), allowed (reason: mode, grant or
-- continuation), denied, parked, expired, auto (Hermes' second approval for an
-- approved call), ran (the worker's host.ran, detail.status), undone.
CREATE TABLE agent_host_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id text NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
    run_id text NOT NULL DEFAULT '',
    tool_call_id text NOT NULL DEFAULT '',
    request_id text NOT NULL DEFAULT '',
    tool text NOT NULL DEFAULT '',
    args_hash text NOT NULL DEFAULT '',
    kind text NOT NULL CHECK (kind IN ('requested', 'approved', 'allowed', 'denied', 'parked', 'expired', 'auto', 'ran', 'undone')),
    choice text NOT NULL DEFAULT '',
    reason text NOT NULL DEFAULT '',
    device jsonb NOT NULL DEFAULT '{}'::jsonb,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_host_events_conversation_idx ON agent_host_events (conversation_id, created_at);
CREATE INDEX agent_host_events_user_idx ON agent_host_events (user_id, created_at);

-- +goose Down
DROP TABLE IF EXISTS agent_host_events;
