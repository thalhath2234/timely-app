-- +goose Up
-- is_template marks a doc offered under "New from template". daily_date
-- (YYYY-MM-DD) marks a daily note, one per day per account.
ALTER TABLE documents ADD COLUMN is_template boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN daily_date text;
CREATE UNIQUE INDEX idx_documents_daily_date ON documents(user_id, daily_date) WHERE daily_date IS NOT NULL;
-- +goose Down
DROP INDEX idx_documents_daily_date;
ALTER TABLE documents DROP COLUMN daily_date;
ALTER TABLE documents DROP COLUMN is_template;
