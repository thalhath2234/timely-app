-- +goose Up
-- An empty default provider means "not chosen": runs use the first provider
-- the person set up, direct API keys and CLIs before OpenRouter (ADR 0019).
-- Every account so far was stored as 'openrouter' by the column default, so
-- those become unchosen; accounts with only an OpenRouter key keep using it.
--
-- Anthropic keys saved so far were given Opus automatically. An account that
-- never made Anthropic its default never ran chat on it, and now will, so its
-- Anthropic model becomes Haiku, the new automatic pick. Accounts that chose
-- Anthropic keep their model.
UPDATE agent_api_keys k SET model = 'claude-haiku-5-5', updated_at = now()
WHERE k.provider = 'anthropic' AND k.model = 'claude-opus-5-5'
  AND NOT EXISTS (SELECT 1 FROM agent_provider_settings s WHERE s.user_id = k.user_id AND s.default_provider = 'anthropic');
ALTER TABLE agent_provider_settings ALTER COLUMN default_provider SET DEFAULT '';
UPDATE agent_provider_settings SET default_provider = '' WHERE default_provider = 'openrouter';

-- +goose Down
-- Anthropic models moved to Haiku stay on Haiku: they cannot be told apart
-- from a Haiku the person chose.
UPDATE agent_provider_settings SET default_provider = 'openrouter' WHERE default_provider = '';
ALTER TABLE agent_provider_settings ALTER COLUMN default_provider SET DEFAULT 'openrouter';
