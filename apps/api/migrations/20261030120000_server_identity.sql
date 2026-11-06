-- +goose Up
-- The id a phone pins when it pairs (GET /health "instanceId"), so it never
-- sends its session to a different Timely server that later answers at a
-- known address. Exactly one row.
CREATE TABLE server_identity (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO server_identity (id) VALUES (gen_random_uuid()::text);

-- +goose Down
DROP TABLE IF EXISTS server_identity;
