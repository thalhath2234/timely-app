-- +goose Up
ALTER TABLE agent_conversations ADD COLUMN sensitive boolean NOT NULL DEFAULT false;
ALTER TABLE agent_conversations ADD COLUMN image_review jsonb;
CREATE TABLE agent_images (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 conversation_id text REFERENCES agent_conversations(id) ON DELETE CASCADE,
 name text NOT NULL,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 deleted_at timestamptz
);
CREATE INDEX agent_images_expiry ON agent_images(expires_at) WHERE deleted_at IS NULL;
CREATE INDEX agent_images_owner ON agent_images(user_id, conversation_id);
-- +goose Down
DROP TABLE agent_images;
ALTER TABLE agent_conversations DROP COLUMN image_review;
ALTER TABLE agent_conversations DROP COLUMN sensitive;
