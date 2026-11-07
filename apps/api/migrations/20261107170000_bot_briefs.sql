-- +goose Up
-- A brief Bot watches nothing of its own: once a day, at brief_time in the
-- notification zone, it collects the new notes of the Bots it sums up (brief
-- links) and sends one alert of kind 'brief'. brief_cursor_at is where the
-- last brief stopped. A source Bot with brief_only alerts only through its
-- briefs. brief_ai is "Write it with AI" (one AI call a run).
ALTER TABLE bots ADD COLUMN kind TEXT NOT NULL DEFAULT 'watch' CHECK (kind IN ('watch', 'brief')),
                 ADD COLUMN brief_only BOOLEAN NOT NULL DEFAULT false,
                 ADD COLUMN brief_ai BOOLEAN NOT NULL DEFAULT false,
                 ADD COLUMN brief_time TEXT NOT NULL DEFAULT '' CHECK (brief_time = '' OR brief_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
                 ADD COLUMN brief_cursor_at TIMESTAMPTZ,
                 ADD CONSTRAINT bots_brief_check CHECK (((kind = 'brief') = (brief_time <> '')) AND (kind = 'brief' OR NOT brief_ai));
ALTER TABLE bot_alerts DROP CONSTRAINT bot_alerts_kind_check;
ALTER TABLE bot_alerts ADD CONSTRAINT bot_alerts_kind_check CHECK (kind IN ('alert', 'more', 'paused', 'brief'));

-- +goose Down
DELETE FROM bot_alerts WHERE kind = 'brief';
DELETE FROM bots WHERE kind = 'brief';
ALTER TABLE bot_alerts DROP CONSTRAINT bot_alerts_kind_check;
ALTER TABLE bot_alerts ADD CONSTRAINT bot_alerts_kind_check CHECK (kind IN ('alert', 'more', 'paused'));
ALTER TABLE bots DROP CONSTRAINT bots_brief_check, DROP COLUMN brief_cursor_at, DROP COLUMN brief_time,
                 DROP COLUMN brief_ai, DROP COLUMN brief_only, DROP COLUMN kind;
