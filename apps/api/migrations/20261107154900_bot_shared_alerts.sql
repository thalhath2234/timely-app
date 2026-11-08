-- +goose Up
-- One alert per thing: two Bots that alert on the same product, ticker or
-- link on the same day share one alert. A sent alert lists the things it
-- told of ([{key, value?, urgency}]); the first alert of a thing lists the
-- Bots that saw it too ([{botId, name}]); a later one is held 'shared' and
-- names the alert it joined. A feed's notes are one per new item, each with
-- the key of the thing it is about.
ALTER TABLE bot_alerts ADD COLUMN things JSONB NOT NULL DEFAULT '[]',
                       ADD COLUMN also_seen_by JSONB NOT NULL DEFAULT '[]',
                       ADD COLUMN shared_with TEXT REFERENCES bot_alerts(id) ON DELETE SET NULL;
CREATE INDEX bot_alerts_things_idx ON bot_alerts USING gin (things jsonb_path_ops);
CREATE INDEX bot_alerts_user_day_idx ON bot_alerts (user_id, local_day);
ALTER TABLE bot_findings ADD COLUMN thing_key TEXT NOT NULL DEFAULT '';

-- +goose Down
DROP INDEX bot_alerts_user_day_idx;
DROP INDEX bot_alerts_things_idx;
ALTER TABLE bot_findings DROP COLUMN thing_key;
ALTER TABLE bot_alerts DROP COLUMN shared_with, DROP COLUMN also_seen_by, DROP COLUMN things;
