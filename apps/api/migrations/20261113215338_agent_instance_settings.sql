-- +goose Up
-- Phase 5 (plan 11.2, 12): settings of the whole instance, not of one account.
-- Keys: host_accounts [{uid, working_dir, added_at}] (accounts whose approved
-- commands may run on this computer), agent_max_workers and
-- agent_idle_minutes. Only the desktop window (the shell token) writes them.
CREATE TABLE instance_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS instance_settings;
