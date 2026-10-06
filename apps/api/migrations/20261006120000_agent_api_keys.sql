-- +goose Up
CREATE TABLE agent_api_keys (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL,
 api_key text NOT NULL DEFAULT '',
 key_hint text NOT NULL DEFAULT '',
 base_url text NOT NULL DEFAULT '',
 model text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, provider)
);
-- +goose Down
DROP TABLE agent_api_keys;
