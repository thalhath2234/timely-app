-- +goose Up
DELETE FROM user_sessions WHERE revoked_at IS NOT NULL;
ALTER TABLE user_sessions DROP COLUMN revoked_at;

-- +goose Down
ALTER TABLE user_sessions ADD COLUMN revoked_at TEXT;
