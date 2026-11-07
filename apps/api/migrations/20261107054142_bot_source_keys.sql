-- +goose Up
-- The API keys a person saves for keyed price sources (Finnhub for stocks).
-- A table of its own keeps them out of agent_api_keys, which the provider
-- overview lists as AI providers. api_key is sealed (internal/secretbox) and
-- never leaves the server; the rows are not backed up, and a restore keeps
-- them (they hang off users, not bots).
CREATE TABLE bot_source_keys (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,                      -- price.Sources name with a KeyHeader ("finnhub")
    api_key TEXT NOT NULL,                     -- secretbox-sealed, base64
    key_hint TEXT NOT NULL,                    -- "…abcd"
    state TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'refused')),
    checked_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source)
);

-- +goose Down
DROP TABLE IF EXISTS bot_source_keys;
