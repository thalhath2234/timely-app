-- +goose Up
-- Expo reports most dead phone tokens only in a push's receipts, a while
-- after the send: a push_receipts job asks for them and deletes the devices
-- Expo says are no longer registered. The list repeats the one in
-- 20261107144306_bot_ai_judge.sql and adds 'push_receipts'.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check', 'bot_icon', 'bot_judge', 'bot_pass', 'push_receipts')) NOT VALID;

-- +goose Down
DELETE FROM jobs WHERE kind = 'push_receipts';
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check', 'bot_icon', 'bot_judge', 'bot_pass')) NOT VALID;
