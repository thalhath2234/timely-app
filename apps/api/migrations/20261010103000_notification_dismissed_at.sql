-- +goose Up
-- A smart alert the person dismisses or clears is hidden, not deleted, so
-- the alerts job can learn which kinds of alert they keep setting aside.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
CREATE INDEX IF NOT EXISTS notifications_user_dismissed_idx ON notifications (user_id, dismissed_at) WHERE dismissed_at IS NOT NULL;

-- +goose Down
DELETE FROM notifications WHERE dismissed_at IS NOT NULL;
DROP INDEX IF EXISTS notifications_user_dismissed_idx;
ALTER TABLE notifications DROP COLUMN IF EXISTS dismissed_at;
