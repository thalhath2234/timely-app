-- +goose Up
-- 20261001133000 was written before 'reindex_user' existed and replaced
-- jobs_kind_check without it, so re-indexing after an embedding model change
-- could not enqueue its job. This states the full list of kinds the code enqueues.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user')) NOT VALID;

-- +goose Down
DELETE FROM jobs WHERE kind = 'reindex_user';
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon')) NOT VALID;
