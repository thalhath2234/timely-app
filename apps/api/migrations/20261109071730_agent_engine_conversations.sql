-- +goose Up
-- Chat on the agent engine (plan 5.4, phase 2). engine is the chat's own
-- choice ('' follows the account's Settings → Agent → Engine), run_engine the
-- engine of the current or latest run, set when a lane claims it.
ALTER TABLE agent_conversations ADD COLUMN engine text NOT NULL DEFAULT ''
    CHECK (engine IN ('', 'classic', 'agent'));
ALTER TABLE agent_conversations ADD COLUMN run_engine text NOT NULL DEFAULT '';
-- How much the agent may change without asking (plan 5.5b). Existing chats
-- become Supervised: every proposal waits for Approve.
ALTER TABLE agent_conversations ADD COLUMN permission text NOT NULL DEFAULT 'supervised'
    CHECK (permission IN ('supervised', 'auto', 'full'));
-- The live agent run and the worker running it ("<pid>:<start unix ms>");
-- both empty when no agent run is live.
ALTER TABLE agent_conversations ADD COLUMN agent_run_id text NOT NULL DEFAULT '';
ALTER TABLE agent_conversations ADD COLUMN agent_instance text NOT NULL DEFAULT '';
-- What the live run is doing ({run, lines, draft}), written at most once a
-- second; it rides the existing change NOTIFY.
ALTER TABLE agent_conversations ADD COLUMN activity jsonb NOT NULL DEFAULT '{}';
-- The run's reads (the hashes a proposal is checked against), kept here
-- because an agent run lives outside the API process.
ALTER TABLE agent_conversations ADD COLUMN run_reads jsonb NOT NULL DEFAULT '{}';
-- Outside sources the chat's runs read; only ever appended to, and cleared
-- only with the chat. A chat with any has every proposal reviewed.
ALTER TABLE agent_conversations ADD COLUMN tainted_sources jsonb NOT NULL DEFAULT '[]';

-- +goose Down
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS tainted_sources;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS run_reads;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS activity;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS agent_instance;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS agent_run_id;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS permission;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS run_engine;
ALTER TABLE agent_conversations DROP COLUMN IF EXISTS engine;
