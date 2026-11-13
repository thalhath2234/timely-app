-- +goose Up
-- Phase 4 (Q-4.3): a question card the agent run waits on. While the worker
-- waits for the person's answer the row stays 'running' and question holds
-- {requestId, run, questions, askedAt, expiresAt}; it is '{}' otherwise.
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS question jsonb NOT NULL DEFAULT '{}'::jsonb;

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS question;
