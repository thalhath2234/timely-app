-- +goose Up
-- Phase 5 review round 4: a command MCP server whose host card was denied,
-- stopped or ran out of time is "not added", not "waiting for your OK".
-- refused_hash is the entry hash of the card that was not approved; the row
-- offers Ask again, which raises a new card.
ALTER TABLE agent_mcp_servers ADD COLUMN refused_hash text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE agent_mcp_servers DROP COLUMN IF EXISTS refused_hash;
