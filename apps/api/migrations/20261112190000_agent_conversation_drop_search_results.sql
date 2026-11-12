-- +goose Up
-- Owner decision Q-3.9 (plan 15): Timely no longer restricts what a tainted
-- chat may search or open on the web, so a chat no longer keeps its clean
-- searches' results for that rule.
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS search_results;

-- +goose Down
ALTER TABLE agent_conversations ADD COLUMN IF NOT EXISTS search_results jsonb NOT NULL DEFAULT '[]'::jsonb;
