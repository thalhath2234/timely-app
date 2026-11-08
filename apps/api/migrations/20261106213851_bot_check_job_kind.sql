-- +goose Up
-- Bots (ADR 0021): a 'bot_check' job checks one Bot, and Bot alerts are
-- notifications of category 'bot'. Both lists repeat every earlier value
-- (20261002012346_restore_reindex_job_kind.sql exists because one was lost).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check')) NOT VALID;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent', 'missed', 'start', 'suggestion', 'bot')) NOT VALID;

-- +goose Down
DELETE FROM notifications WHERE category = 'bot';
DELETE FROM jobs WHERE kind = 'bot_check';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent', 'missed', 'start', 'suggestion')) NOT VALID;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts')) NOT VALID;
