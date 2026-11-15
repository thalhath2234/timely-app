-- +goose Up
-- Phase 5 (plan 5.1, 5.5, 5.5b): a host card the run waits on, the grants a
-- person gave a chat, a parked card's continuation and the Full Access
-- step-up.
--   host_request  {requestId, run, phase live|parked, tool, toolCallId,
--                  argsHash, card, askedAt, liveUntil, expiresAt}; '{}' when
--                  no host card is open. The row's status is 'host_approval'.
--   host_grants   [{kind, key, label, at}] "Allow for this chat" grants.
--   continuation  {tool, argsHash, toolCallId, requestId, text} for the next
--                 claim of a parked card that was approved; '{}' otherwise.
--   full_access   {at, device} the step-up record; a chat on 'full' without
--                 one acts as Auto.
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS host_request jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS host_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS continuation jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS full_access jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Full Access now needs a step-up that no stored chat has, so every stored
-- 'full' (chat and account defaults) becomes 'auto'. The down step cannot
-- tell which rows were 'full' and leaves them on 'auto'.
UPDATE agent_conversations SET permission = 'auto' WHERE permission = 'full';
UPDATE agent_chat_settings SET chat_permission = 'auto' WHERE chat_permission = 'full';
UPDATE agent_chat_settings SET bot_permission = 'auto' WHERE bot_permission = 'full';

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS full_access;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS continuation;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS host_grants;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS host_request;
