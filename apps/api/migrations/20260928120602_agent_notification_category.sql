-- +goose Up
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('reminder', 'digest', 'planning', 'overdue', 'agent')) NOT VALID;

-- +goose Down
UPDATE notifications SET category = 'planning' WHERE category = 'agent';
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('reminder', 'digest', 'planning', 'overdue')) NOT VALID;
