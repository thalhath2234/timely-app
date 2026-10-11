-- +goose Up
-- Smart alerts (Jev Phase 8): a daily 'smart_alerts' job writes notifications
-- of category 'suggestion' for optional suggestions worth an alert.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts')) NOT VALID;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent', 'missed', 'start', 'suggestion')) NOT VALID;

-- +goose Down
DELETE FROM notifications WHERE category = 'suggestion';
DELETE FROM jobs WHERE kind = 'smart_alerts';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent', 'missed', 'start')) NOT VALID;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user')) NOT VALID;
