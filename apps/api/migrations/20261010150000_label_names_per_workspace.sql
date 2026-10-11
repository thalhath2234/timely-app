-- +goose Up
-- Label names were unique across the whole database, so one account's
-- "Finance" stopped every other account (and every other workspace) from
-- making a label with that name. A name is now unique within its workspace.
ALTER TABLE lables DROP CONSTRAINT IF EXISTS lables_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS lables_workspace_name_key ON lables (workspace_id, name);

-- +goose Down
DROP INDEX IF EXISTS lables_workspace_name_key;
ALTER TABLE lables ADD CONSTRAINT lables_name_key UNIQUE (name);
