-- +goose Up
ALTER TABLE stages ADD COLUMN color TEXT;
ALTER TABLE workspaces ADD COLUMN color TEXT;

-- +goose Down
ALTER TABLE stages DROP COLUMN color;
ALTER TABLE workspaces DROP COLUMN color;
