-- +goose Up
-- Pass to: a link from one Bot to another. When the first finds something
-- whose note holds one of the filter words (or any note, with no words), the
-- second checks that note under its own rules, caps and allowed sites, and
-- the alert comes from the end of the chain. A brief link (a later commit)
-- names a source of a brief Bot. Links are backed up.
CREATE TABLE bot_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('pass', 'brief')),
    from_bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    to_bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    filter JSONB NOT NULL DEFAULT '[]',
    enabled BOOLEAN NOT NULL DEFAULT true,
    off_reason TEXT NOT NULL DEFAULT '' CHECK (off_reason IN ('', 'person')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bot_links_self_check CHECK (from_bot_id <> to_bot_id),
    CONSTRAINT bot_links_filter_check CHECK (kind = 'pass' OR filter = '[]'::jsonb),
    CONSTRAINT bot_links_off_check CHECK (enabled OR off_reason <> '')
);
CREATE UNIQUE INDEX bot_links_pair_idx ON bot_links (from_bot_id, to_bot_id, kind);
CREATE INDEX bot_links_to_idx ON bot_links (to_bot_id);
CREATE INDEX bot_links_user_idx ON bot_links (user_id);

-- The pass log: the 20-a-day link limit, the 7-day repeat rule and folding.
-- No foreign keys to bots, links or findings: deleting a Bot or restoring a
-- backup must not reset a count, and the job folds a pass whose Bot, link or
-- note is gone. Not backed up; pruned after 30 days.
CREATE TABLE bot_passes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link_id TEXT,
    from_bot_id TEXT NOT NULL,
    to_bot_id TEXT NOT NULL,
    finding_id TEXT,
    thing_key TEXT NOT NULL DEFAULT '',
    chain_id TEXT NOT NULL,
    depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 3),
    local_day DATE NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'alerted', 'quiet', 'failed', 'folded', 'overflow', 'repeat')),
    check_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_passes_link_day_idx ON bot_passes (link_id, local_day);
CREATE INDEX bot_passes_repeat_idx ON bot_passes (to_bot_id, thing_key, created_at DESC);
CREATE INDEX bot_passes_user_idx ON bot_passes (user_id, created_at DESC);
CREATE INDEX bot_passes_folded_idx ON bot_passes (user_id, updated_at) WHERE state IN ('folded', 'overflow', 'failed');

-- notify_bot_change() sends COALESCE(bot_id, id), which for a link is its own
-- id, so a link announces both of its Bots instead.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_bot_link_change() RETURNS trigger AS $$
DECLARE
    j jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        j := to_jsonb(OLD);
    ELSE
        j := to_jsonb(NEW);
    END IF;
    PERFORM pg_notify('timely_bots', json_build_object('schema', TG_TABLE_SCHEMA, 'user', j->>'user_id', 'id', j->>'from_bot_id')::text);
    PERFORM pg_notify('timely_bots', json_build_object('schema', TG_TABLE_SCHEMA, 'user', j->>'user_id', 'id', j->>'to_bot_id')::text);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER bot_links_notify AFTER INSERT OR UPDATE OR DELETE ON bot_links
    FOR EACH ROW EXECUTE FUNCTION notify_bot_link_change();

-- A check a passed note starts is logged with the trigger pass, and "Not
-- useful" on a passed alert can say it should not have been passed on.
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_trigger_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_trigger_check CHECK (trigger IN ('schedule', 'wake', 'run_now', 'ask', 'pass'));
ALTER TABLE bot_alerts DROP CONSTRAINT bot_alerts_feedback_reason_check;
ALTER TABLE bot_alerts ADD CONSTRAINT bot_alerts_feedback_reason_check CHECK (feedback_reason IN ('', 'too_small', 'not_wanted', 'already_knew', 'not_passed'));
-- "How this came to you": [{botId, name, linkId, title}] from the start of
-- the chain to the Bot that passed it last.
ALTER TABLE bot_alerts ADD COLUMN via JSONB NOT NULL DEFAULT '[]';
-- A note made by a passed check names its chain, its step in it and the note
-- it was passed.
ALTER TABLE bot_findings ADD COLUMN chain_id TEXT NOT NULL DEFAULT '',
                         ADD COLUMN depth INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 3),
                         ADD COLUMN source_finding_id TEXT REFERENCES bot_findings(id) ON DELETE SET NULL;

-- +goose Down
UPDATE bot_alerts SET feedback_reason = '' WHERE feedback_reason = 'not_passed';
UPDATE bot_checks SET trigger = 'run_now' WHERE trigger = 'pass';
ALTER TABLE bot_alerts DROP CONSTRAINT bot_alerts_feedback_reason_check;
ALTER TABLE bot_alerts ADD CONSTRAINT bot_alerts_feedback_reason_check CHECK (feedback_reason IN ('', 'too_small', 'not_wanted', 'already_knew'));
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_trigger_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_trigger_check CHECK (trigger IN ('schedule', 'wake', 'run_now', 'ask'));

ALTER TABLE bot_findings DROP COLUMN source_finding_id, DROP COLUMN depth, DROP COLUMN chain_id;
ALTER TABLE bot_alerts DROP COLUMN via;

DROP TRIGGER IF EXISTS bot_links_notify ON bot_links;
DROP FUNCTION IF EXISTS notify_bot_link_change();

DROP TABLE IF EXISTS bot_passes;
DROP TABLE IF EXISTS bot_links;
