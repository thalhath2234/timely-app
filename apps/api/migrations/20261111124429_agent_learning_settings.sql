-- +goose Up
-- Per-account learning settings (Q-3.1, Q-3.3, Q-3.4, Q-3.5). A missing row
-- reads as the defaults: learning on, past-chat search on. use_case_copied_at
-- is set once "What you use Timely for" has been copied into About you, so it
-- is never copied again. skills_disabled holds the skills the person turned
-- off (and the restored ones); skills_restored the skills a backup restore
-- brought back, shown as "restored, review" until turned on.
CREATE TABLE agent_learning_settings (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    learning boolean NOT NULL DEFAULT true,
    search_history boolean NOT NULL DEFAULT true,
    use_case_copied_at timestamptz,
    skills_disabled jsonb NOT NULL DEFAULT '[]',
    skills_restored jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS agent_learning_settings;
