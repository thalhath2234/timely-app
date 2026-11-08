-- +goose Up
-- Site logos for the Bots page (ADR 0021): one 64x64 PNG per registrable
-- domain, fetched by a 'bot_icon' job through the Bots fetcher and redrawn,
-- so nothing a site sent is served as it came. The cache is shared and has
-- no owner (GET /bots/icons serves only sites the caller watches), is not
-- backed up, and drops a logo nobody asked for in 60 days. body NULL means
-- the site has no logo Timely could read.
CREATE TABLE bot_site_icons (
    site TEXT PRIMARY KEY,
    body BYTEA CHECK (body IS NULL OR octet_length(body) <= 16384),
    fetched_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NOT NULL
);

-- The list repeats every earlier kind (see 20261106213851_bot_check_job_kind.sql).
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check', 'bot_icon')) NOT VALID;

-- +goose Down
DELETE FROM jobs WHERE kind = 'bot_icon';

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('send_reminder', 'index_entity', 'daily_digest', 'send_push', 'create_backup', 'overdue_task', 'missed_block', 'start_soon', 'reindex_user', 'smart_alerts', 'bot_check')) NOT VALID;

DROP TABLE IF EXISTS bot_site_icons;
