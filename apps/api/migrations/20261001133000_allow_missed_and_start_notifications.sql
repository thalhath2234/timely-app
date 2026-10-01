-- +goose Up
-- The missed-Block and start-soon sweeps enqueue jobs of kind 'missed_block'
-- and 'start_soon' and write notifications of category 'missed' and 'start',
-- but the check constraints only knew the older kinds, so every insert failed
-- (QA-08 in docs/qa/2026-10-01-remediation).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon')) NOT VALID;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent', 'missed', 'start')) NOT VALID;

-- +goose Down
-- These rows cannot be represented by the previous schema.
DELETE FROM notifications WHERE category IN ('missed', 'start');
DELETE FROM jobs WHERE kind IN ('missed_block', 'start_soon');

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_category_check CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent')) NOT VALID;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task')) NOT VALID;
