-- +goose Up
-- An empty default provider means "not chosen": runs use the first ready
-- provider, direct API keys and CLIs before OpenRouter (ADR 0019). Every
-- account so far was stored as 'openrouter' by the column default, so those
-- become unchosen; accounts with only an OpenRouter key keep using it.
ALTER TABLE agent_provider_settings ALTER COLUMN default_provider SET DEFAULT '';
UPDATE agent_provider_settings SET default_provider = '' WHERE default_provider = 'openrouter';

-- +goose Down
UPDATE agent_provider_settings SET default_provider = 'openrouter' WHERE default_provider = '';
ALTER TABLE agent_provider_settings ALTER COLUMN default_provider SET DEFAULT 'openrouter';
