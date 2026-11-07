-- +goose Up
-- A Bot tagged in chat answers from its latest findings, and checks once
-- first when they are over an hour old. asked_at is when a tag last started
-- such a check, so a Bot is checked for tags at most once every 5 minutes;
-- those checks are logged with the trigger ask.
ALTER TABLE bots ADD COLUMN asked_at TIMESTAMPTZ;
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_trigger_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_trigger_check CHECK (trigger IN ('schedule', 'wake', 'run_now', 'ask'));

-- +goose Down
UPDATE bot_checks SET trigger = 'run_now' WHERE trigger = 'ask';
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_trigger_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_trigger_check CHECK (trigger IN ('schedule', 'wake', 'run_now'));
ALTER TABLE bots DROP COLUMN asked_at;
