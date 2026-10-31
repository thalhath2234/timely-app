-- +goose Up
-- Where tasks made from a doc's Make task offers go, when the person picked
-- it: "inbox" or a project id. No row: the automatic place (the doc's
-- project, else a suggested or related one). Kept apart from documents so
-- the doc itself, its markdown and MCP stay as they are.
CREATE TABLE doc_offer_targets (
    doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS doc_offer_targets;
