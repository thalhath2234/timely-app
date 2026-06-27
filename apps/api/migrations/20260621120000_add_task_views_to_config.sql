-- +goose Up
ALTER TABLE configs
    ADD COLUMN IF NOT EXISTS task_views        JSONB   NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS active_task_view_id TEXT  NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS version           INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_configs_user_id ON configs(user_id);

-- Backfill existing rows with default views
UPDATE configs
SET
    task_views = '[
      {"id":"view_task_list","name":"Task List","dataMode":"task","renderMode":"list","groupFields":["workspace","project","stage"],"groupSortDirection":"asc","groupValueOrders":{},"sortBy":"deadline","sortDirection":"asc","selectedWorkspaceIds":[]},
      {"id":"view_my_deadlines","name":"My Deadlines","dataMode":"task","renderMode":"list","groupFields":["priority"],"groupSortDirection":"asc","groupValueOrders":{},"sortBy":"deadline","sortDirection":"asc","selectedWorkspaceIds":[]},
      {"id":"view_overview","name":"Overview","dataMode":"task","renderMode":"list","groupFields":["workspace"],"groupSortDirection":"asc","groupValueOrders":{},"sortBy":"createdAt","sortDirection":"desc","selectedWorkspaceIds":[]},
      {"id":"view_project_timelines","name":"Project Timelines","dataMode":"project","renderMode":"gantt","groupFields":["workspace"],"groupSortDirection":"asc","groupValueOrders":{},"sortBy":"startDate","sortDirection":"asc","selectedWorkspaceIds":[]}
    ]'::jsonb,
    active_task_view_id = 'view_task_list'
WHERE task_views = '[]'::jsonb OR jsonb_array_length(task_views) = 0;

-- +goose Down
ALTER TABLE configs
    DROP COLUMN IF EXISTS task_views,
    DROP COLUMN IF EXISTS active_task_view_id,
    DROP COLUMN IF EXISTS version;

DROP INDEX IF EXISTS idx_configs_user_id;
