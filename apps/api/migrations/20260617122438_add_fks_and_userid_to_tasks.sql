-- +goose Up
ALTER TABLE tasks
ADD COLUMN user_id TEXT NOT NULL;
ALTER TABLE tasks
ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE tasks
DROP COLUMN user_id;
