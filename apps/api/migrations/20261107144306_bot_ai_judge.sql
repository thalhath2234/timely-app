-- +goose Up
-- An AI judge decides what an "AI judges" Bot's rules spot (ADR 0024). Each
-- alert records how AI saw it: judged, unchecked (AI was off, used up or
-- unavailable; ai_why says which) or rejudged (a later verdict said it was
-- not worth it). ai_input keeps the judge's input only while a re-judge is
-- queued; it is never backed up. A verdict of "not worth it" still writes
-- the alert, held 'judged', so the person can see it and teach the Bot.
-- 'shared' is held by one alert per thing (a later commit).
ALTER TABLE bot_alerts
    ADD COLUMN ai_state TEXT NOT NULL DEFAULT '' CHECK (ai_state IN ('', 'judged', 'unchecked', 'rejudged')),
    ADD COLUMN ai_why TEXT NOT NULL DEFAULT '' CHECK (char_length(ai_why) <= 400),
    ADD COLUMN ai_input JSONB,
    ADD COLUMN urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high'));
ALTER TABLE bot_alerts DROP CONSTRAINT bot_alerts_held_check;
ALTER TABLE bot_alerts ADD CONSTRAINT bot_alerts_held_check CHECK (held IN ('', 'snoozed', 'cap', 'judged', 'shared'));
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_outcome_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_outcome_check CHECK (outcome IN ('baseline', 'unchanged', 'not_modified',
    'changed', 'fired', 'offline', 'rate_limited', 'site_busy', 'robots', 'strike', 'superseded', 'judged_quiet', 'passed'));

-- One row per AI call a Bot makes, for the daily caps (20 per Bot, 200 per
-- account, 6 per chain) and the board's "AI checks today". No foreign key
-- to bots: deleting a Bot or restoring a backup must not reset a count. Not
-- backed up; pruned after 30 days.
CREATE TABLE bot_ai_calls (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL,
    chain_id TEXT NOT NULL DEFAULT '',
    local_day DATE NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('judge', 'rejudge', 'brief')),
    ok BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_ai_calls_user_day_idx ON bot_ai_calls (user_id, local_day);
CREATE INDEX bot_ai_calls_bot_day_idx ON bot_ai_calls (bot_id, local_day);
CREATE INDEX bot_ai_calls_chain_idx ON bot_ai_calls (chain_id) WHERE chain_id <> '';

-- The list repeats every earlier kind (see 20261107073012_bot_site_icons.sql).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check', 'bot_icon', 'bot_judge', 'bot_pass')) NOT VALID;

-- +goose Down
DELETE FROM jobs WHERE kind IN ('bot_judge', 'bot_pass');
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check', 'bot_icon')) NOT VALID;

DROP TABLE IF EXISTS bot_ai_calls;

UPDATE bot_checks SET outcome = 'fired' WHERE outcome IN ('judged_quiet', 'passed');
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_outcome_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_outcome_check CHECK (outcome IN ('baseline', 'unchanged', 'not_modified',
    'changed', 'fired', 'offline', 'rate_limited', 'site_busy', 'robots', 'strike', 'superseded'));

DELETE FROM bot_alerts WHERE held IN ('judged', 'shared');
ALTER TABLE bot_alerts DROP CONSTRAINT bot_alerts_held_check;
ALTER TABLE bot_alerts ADD CONSTRAINT bot_alerts_held_check CHECK (held IN ('', 'snoozed', 'cap'));

ALTER TABLE bot_alerts DROP COLUMN urgency, DROP COLUMN ai_input, DROP COLUMN ai_why, DROP COLUMN ai_state;
