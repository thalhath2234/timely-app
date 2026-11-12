-- +goose Up
-- The result addresses of the web searches a chat made before it read outside
-- content (plan 8.1, 12). After taint only these, a link the person typed and
-- a site's front page may be opened; a search made after taint may have been
-- asked for by an injected page. Go keeps them so a later run (and the
-- worker, through run.start.search_results) still opens them.
ALTER TABLE agent_conversations ADD COLUMN search_results jsonb NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS search_results;
