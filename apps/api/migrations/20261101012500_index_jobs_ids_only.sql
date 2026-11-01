-- +goose NO TRANSACTION
-- +goose Up
-- Index jobs used to carry the item's title and full text, kept for good and
-- shown by GET /jobs and MCP list_jobs, even after the item was deleted. Jobs
-- now name the item only and read its text when they run, so the text is
-- dropped from the rows written before. Batches commit one by one so a large
-- jobs table is never locked for long.
-- +goose StatementBegin
DO $$
DECLARE
    changed integer;
BEGIN
    LOOP
        UPDATE jobs SET payload = payload - 'title' - 'body'
        WHERE id IN (
            SELECT id FROM jobs
            WHERE kind = 'index_entity' AND (payload ? 'title' OR payload ? 'body')
            LIMIT 5000
        );
        GET DIAGNOSTICS changed = ROW_COUNT;
        EXIT WHEN changed = 0;
        COMMIT;
    END LOOP;
END $$;
-- +goose StatementEnd

-- +goose Down
-- The dropped text cannot be put back; the jobs read it when they run.
SELECT 1;
