-- +goose Up
-- An AI-judged Bot can read one of the person's docs or sheets as knowledge
-- for its judge ("the most I'll pay"). Read only when the judge is called,
-- and only as data. No foreign key: docs and sheets can be deleted or moved
-- to the bin, and every read checks the row is still the person's.
ALTER TABLE bots ADD COLUMN knowledge_kind TEXT NOT NULL DEFAULT '' CHECK (knowledge_kind IN ('', 'doc', 'sheet')),
                 ADD COLUMN knowledge_id TEXT NOT NULL DEFAULT '',
                 ADD CONSTRAINT bots_knowledge_check CHECK ((knowledge_kind = '') = (knowledge_id = ''));

-- +goose Down
ALTER TABLE bots DROP CONSTRAINT bots_knowledge_check, DROP COLUMN knowledge_id, DROP COLUMN knowledge_kind;
