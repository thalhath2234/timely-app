-- +goose Up
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task')) NOT VALID;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue')) NOT VALID;

-- +goose Down
-- These rows cannot be represented by the previous schema.
DELETE FROM notifications WHERE category = 'overdue';
DELETE FROM jobs WHERE kind = 'overdue_task';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning')) NOT VALID;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup')) NOT VALID;
