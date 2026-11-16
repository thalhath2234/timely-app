-- +goose Up
-- Phase 7 (plan 9b.3, Q1/Q6): each Bot has its own skill bot-<skill_slug>,
-- made by the agent worker on the Bot's first tick. skill_slug is made from
-- the Bot's name the first time it is needed, kept on rename, unique within
-- the account ('' until then). taught_seed is what the person taught the Bot
-- before it had a skill: the first tick writes it as the skill's "What you
-- taught me" section and Go clears it.
ALTER TABLE bots
    ADD COLUMN skill_slug text NOT NULL DEFAULT ''
        CHECK (skill_slug = '' OR skill_slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
    ADD COLUMN taught_seed text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX bots_user_skill_slug_idx ON bots (user_id, skill_slug) WHERE skill_slug <> '';

-- Each Bot's lessons, oldest first, one line each, become its taught_seed;
-- then bot_lessons goes (the old feedback-writes-a-lesson path is gone).
UPDATE bots b SET taught_seed = l.seed
FROM (SELECT bot_id, string_agg(replace(text, E'\n', ' '), E'\n' ORDER BY created_at, id) AS seed
      FROM bot_lessons GROUP BY bot_id) l
WHERE l.bot_id = b.id;
DROP TRIGGER IF EXISTS bot_lessons_notify ON bot_lessons;
DROP TABLE IF EXISTS bot_lessons;

-- A note or Not useful on an alert keeps the note with either rating (a
-- reason still only with Not useful); either queues a feedback review job.
ALTER TABLE bot_alerts DROP CONSTRAINT IF EXISTS bot_alerts_feedback_shape_check;
ALTER TABLE bot_alerts
    ADD CONSTRAINT bot_alerts_feedback_shape_check
        CHECK (feedback = 'not_useful' OR (feedback_reason = '' AND (feedback IS NOT NULL OR feedback_note = '')));

-- Every earlier job kind and category is repeated (see 20261106213851).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check', 'bot_icon', 'bot_judge', 'bot_pass', 'push_receipts', 'bot_review')) NOT VALID;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent', 'missed', 'start', 'suggestion', 'bot', 'bot_learned')) NOT VALID;

-- A Bot page lists its own learning events (GET /agent/learning/events?botId=).
CREATE INDEX agent_learning_events_user_bot_idx ON agent_learning_events (user_id, bot_id, created_at DESC) WHERE bot_id <> '';

-- +goose Down
DROP INDEX IF EXISTS agent_learning_events_user_bot_idx;

DELETE FROM notifications WHERE category = 'bot_learned';
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent', 'missed', 'start', 'suggestion', 'bot')) NOT VALID;

DELETE FROM jobs WHERE kind = 'bot_review';
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check', 'bot_icon', 'bot_judge', 'bot_pass', 'push_receipts')) NOT VALID;

UPDATE bot_alerts SET feedback_note = '' WHERE feedback = 'useful';
ALTER TABLE bot_alerts DROP CONSTRAINT IF EXISTS bot_alerts_feedback_shape_check;
ALTER TABLE bot_alerts
    ADD CONSTRAINT bot_alerts_feedback_shape_check CHECK (feedback = 'not_useful' OR (feedback_reason = '' AND feedback_note = ''));

CREATE TABLE bot_lessons (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_id TEXT REFERENCES bot_alerts(id) ON DELETE SET NULL,
    text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_lessons_bot_idx ON bot_lessons (bot_id, created_at);
CREATE TRIGGER bot_lessons_notify AFTER INSERT OR UPDATE OR DELETE ON bot_lessons
    FOR EACH ROW EXECUTE FUNCTION notify_bot_change();
-- A seed not yet written into a skill comes back as lessons, one per line, in
-- order (a second apart, so created_at keeps it).
INSERT INTO bot_lessons (id, bot_id, user_id, text, created_at)
SELECT 'bls_' || md5(b.id || ':' || s.n), b.id, b.user_id, left(s.line, 200), b.created_at + (s.n * interval '1 second')
FROM bots b, LATERAL unnest(string_to_array(b.taught_seed, E'\n')) WITH ORDINALITY AS s(line, n)
WHERE b.taught_seed <> '' AND btrim(s.line) <> '';

DROP INDEX IF EXISTS bots_user_skill_slug_idx;
ALTER TABLE bots DROP COLUMN IF EXISTS taught_seed, DROP COLUMN IF EXISTS skill_slug;
