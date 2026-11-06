-- +goose Up
-- One-time codes the desktop adds to its pairing QR so the phone signs in
-- without a password (POST /pairing-codes, POST /auth/pair). Only a SHA-256
-- of the code is stored.
CREATE TABLE pairing_codes (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX idx_pairing_codes_user_id ON pairing_codes (user_id);

-- +goose Down
DROP TABLE IF EXISTS pairing_codes;
