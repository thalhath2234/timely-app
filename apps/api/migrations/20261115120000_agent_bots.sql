-- +goose Up
-- Phase 6 (plan 7.2): agent bots. A Bot with engine 'agent' is a scheduled
-- agent run on the New engine: a prompt, a schedule, tools, a permission mode
-- and a Bot thread, instead of watches and rules. Rules bots keep every
-- column they had.
ALTER TABLE bots
    ADD COLUMN prompt text NOT NULL DEFAULT '',
    ADD COLUMN schedule jsonb NOT NULL DEFAULT '{}',        -- {everyMinutes} | {dailyAt, weekdays} | {cron}
    ADD COLUMN timezone text NOT NULL DEFAULT '',           -- IANA zone the schedule reads in
    ADD COLUMN skills jsonb NOT NULL DEFAULT '[]',          -- skill names the run may load
    ADD COLUMN tools jsonb NOT NULL DEFAULT '{}',           -- {browserSites, egress, useMemory, mcp}
    ADD COLUMN model_provider text NOT NULL DEFAULT '',     -- '' follows the account default
    ADD COLUMN model text NOT NULL DEFAULT '',
    ADD COLUMN gate text NOT NULL DEFAULT 'changed' CHECK (gate IN ('changed', 'always')),
    ADD COLUMN egress jsonb NOT NULL DEFAULT '[]',          -- extra hosts outbound URL tools may reach
    ADD COLUMN market_hours boolean NOT NULL DEFAULT false,
    ADD COLUMN engine text NOT NULL DEFAULT 'rules' CHECK (engine IN ('rules', 'agent')),
    ADD COLUMN permission text NOT NULL DEFAULT 'auto' CHECK (permission IN ('supervised', 'auto', 'full')),
    ADD COLUMN use_memory boolean NOT NULL DEFAULT false,   -- memory and About you (Q-B10); off by default
    ADD COLUMN thread_id text;                              -- the Bot thread (agent_conversations.id, kind 'bot_thread'); no foreign key, the thread points back by bot_id

-- What the Bot remembers between runs: small notes it keeps for itself.
CREATE TABLE bot_notes (
    bot_id text NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key text NOT NULL,
    value text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bot_id, key)
);
CREATE INDEX bot_notes_user_idx ON bot_notes (user_id);

-- A tick of an agent bot: the run's own record, whether the gate let it
-- through, and why it was skipped.
ALTER TABLE bot_checks
    ADD COLUMN run jsonb,
    ADD COLUMN gate_skipped boolean NOT NULL DEFAULT false,
    ADD COLUMN skip_reason text NOT NULL DEFAULT '' CHECK (skip_reason IN ('', 'browser_busy', 'no_ai', 'unchanged', 'duplicate'));
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_outcome_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_outcome_check CHECK (outcome IN ('baseline', 'unchanged', 'not_modified',
    'changed', 'fired', 'offline', 'rate_limited', 'site_busy', 'robots', 'strike', 'superseded', 'judged_quiet', 'passed',
    'held_stock', 'silent', 'alerted', 'skipped', 'failed', 'browser_busy', 'no_ai', 'duplicate'));

-- A run's proposed Timely write waits on the alert as a Review card (Q-B5);
-- the fingerprint holds the same alert again within 7 days.
ALTER TABLE bot_alerts
    ADD COLUMN proposal jsonb,
    ADD COLUMN proposal_state text NOT NULL DEFAULT '' CHECK (proposal_state IN ('', 'pending', 'approved', 'applied', 'dismissed', 'undone', 'failed')),
    ADD COLUMN fingerprint text NOT NULL DEFAULT '';
ALTER TABLE bot_alerts DROP CONSTRAINT bot_alerts_held_check;
ALTER TABLE bot_alerts ADD CONSTRAINT bot_alerts_held_check CHECK (held IN ('', 'snoozed', 'cap', 'judged', 'shared', 'duplicate'));
CREATE INDEX bot_alerts_fingerprint_idx ON bot_alerts (bot_id, fingerprint, created_at DESC) WHERE fingerprint <> '';

ALTER TABLE bot_ai_calls DROP CONSTRAINT bot_ai_calls_purpose_check;
ALTER TABLE bot_ai_calls ADD CONSTRAINT bot_ai_calls_purpose_check CHECK (purpose IN ('judge', 'rejudge', 'brief', 'run'));

-- The Bot thread is a chat conversation: kind 'bot_thread' with its bot_id
-- (one per Bot). from_bot_id marks a chat "Do this in chat" started from a
-- Bot's alert.
ALTER TABLE agent_conversations
    ADD COLUMN kind text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'bot_thread')),
    ADD COLUMN bot_id text REFERENCES bots(id) ON DELETE CASCADE,
    ADD COLUMN from_bot_id text REFERENCES bots(id) ON DELETE SET NULL,
    ADD CONSTRAINT agent_conversations_bot_thread_check CHECK ((kind = 'bot_thread') = (bot_id IS NOT NULL));
CREATE UNIQUE INDEX agent_conversations_bot_thread_idx ON agent_conversations (bot_id) WHERE kind = 'bot_thread';

-- +goose Down
DROP INDEX IF EXISTS agent_conversations_bot_thread_idx;
ALTER TABLE agent_conversations
    DROP CONSTRAINT IF EXISTS agent_conversations_bot_thread_check,
    DROP COLUMN from_bot_id,
    DROP COLUMN bot_id,
    DROP COLUMN kind;

DELETE FROM bot_ai_calls WHERE purpose = 'run';
ALTER TABLE bot_ai_calls DROP CONSTRAINT bot_ai_calls_purpose_check;
ALTER TABLE bot_ai_calls ADD CONSTRAINT bot_ai_calls_purpose_check CHECK (purpose IN ('judge', 'rejudge', 'brief'));

DROP INDEX IF EXISTS bot_alerts_fingerprint_idx;
DELETE FROM bot_alerts WHERE held = 'duplicate';
ALTER TABLE bot_alerts DROP CONSTRAINT bot_alerts_held_check;
ALTER TABLE bot_alerts ADD CONSTRAINT bot_alerts_held_check CHECK (held IN ('', 'snoozed', 'cap', 'judged', 'shared'));
ALTER TABLE bot_alerts DROP COLUMN fingerprint, DROP COLUMN proposal_state, DROP COLUMN proposal;

UPDATE bot_checks SET outcome = 'changed' WHERE outcome IN ('silent', 'alerted', 'skipped', 'failed', 'browser_busy', 'no_ai', 'duplicate');
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_outcome_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_outcome_check CHECK (outcome IN ('baseline', 'unchanged', 'not_modified',
    'changed', 'fired', 'offline', 'rate_limited', 'site_busy', 'robots', 'strike', 'superseded', 'judged_quiet', 'passed',
    'held_stock'));
ALTER TABLE bot_checks DROP COLUMN skip_reason, DROP COLUMN gate_skipped, DROP COLUMN run;

DROP TABLE IF EXISTS bot_notes;

ALTER TABLE bots
    DROP COLUMN thread_id,
    DROP COLUMN use_memory,
    DROP COLUMN permission,
    DROP COLUMN engine,
    DROP COLUMN market_hours,
    DROP COLUMN egress,
    DROP COLUMN gate,
    DROP COLUMN model,
    DROP COLUMN model_provider,
    DROP COLUMN tools,
    DROP COLUMN skills,
    DROP COLUMN timezone,
    DROP COLUMN schedule,
    DROP COLUMN prompt;
