-- +goose Up
-- Phase 5 (Q-5.7, plan 5.5b): who may answer a host card (any signed-in
-- device with the phone unlocked, or only the desktop window), how long a
-- parked card waits (10 to 60 minutes), and the step-up record for the
-- account's Full Access default.
ALTER TABLE agent_chat_settings ADD COLUMN IF NOT EXISTS host_approval_rule text NOT NULL DEFAULT 'devices'
    CHECK (host_approval_rule IN ('devices', 'desktop'));
ALTER TABLE agent_chat_settings ADD COLUMN IF NOT EXISTS host_approval_timeout_minutes integer NOT NULL DEFAULT 60
    CHECK (host_approval_timeout_minutes BETWEEN 10 AND 60);
ALTER TABLE agent_chat_settings ADD COLUMN IF NOT EXISTS full_access_default jsonb NOT NULL DEFAULT '{}'::jsonb;

-- +goose Down
ALTER TABLE agent_chat_settings DROP COLUMN IF EXISTS full_access_default;
ALTER TABLE agent_chat_settings DROP COLUMN IF EXISTS host_approval_timeout_minutes;
ALTER TABLE agent_chat_settings DROP COLUMN IF EXISTS host_approval_rule;
