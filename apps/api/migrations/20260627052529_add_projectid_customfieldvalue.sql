-- +goose Up
ALTER TABLE custom_field_values
ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects (id) ON DELETE CASCADE;

CREATE INDEX idx_custom_field_values_project_id ON custom_field_values (project_id);

-- +goose Down
ALTER TABLE custom_field_values
DROP COLUMN IF EXISTS project_id;

DROP INDEX IF EXISTS idx_custom_field_values_project_id;