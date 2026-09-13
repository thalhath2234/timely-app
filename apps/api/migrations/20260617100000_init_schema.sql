-- +goose Up
-- Create users table

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
);

-- Create workspaces table
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT
);

-- Create statuses table
CREATE TABLE statuses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TEXT,
    updated_at TEXT
);

-- Create lables table (Note: kept as "lables" to match existing model)
CREATE TABLE lables (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    color TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT
);

-- Create schedules table
CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT,
    created_at TEXT,
    updated_at TEXT
);

-- Create projects table
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status_id TEXT,
    deadline DATE,
    start_date DATE,
    completed_at TIMESTAMPTZ,
    priority_level TEXT,
    color TEXT,
    does_have_stages BOOLEAN DEFAULT FALSE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT
);

-- Create stages table
CREATE TABLE stages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    "order" INTEGER,
    created_at TEXT,
    updated_at TEXT,
    project_id TEXT
);

-- Create tasks table
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    time_chunks INTEGER DEFAULT 30,
    duration INTEGER DEFAULT 0,
    deadline DATE,
    start_date DATE,
    scheduled_on TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TEXT,
    updated_at TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    status_id TEXT REFERENCES statuses(id) ON DELETE SET NULL,
    priority_level TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    schedule_id TEXT REFERENCES schedules(id) ON DELETE SET NULL,
    stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
    blocked_by_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    label_ids JSONB 
);

-- Create custom_fields table
CREATE TABLE custom_fields (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    type TEXT NOT NULL,
    options JSONB
);

-- Create custom_field_values table
CREATE TABLE custom_field_values (
    id TEXT PRIMARY KEY,
    custom_field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    options_value JSONB,
    type TEXT NOT NULL,
    string_value TEXT,
    created_at TEXT,
    updated_at TEXT
);

-- Create indexes for better query performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_workspaces_user_id ON workspaces(user_id);
CREATE INDEX idx_statuses_workspace_id ON statuses(workspace_id);
CREATE INDEX idx_lables_workspace_id ON lables(workspace_id);
CREATE INDEX idx_projects_workspace_id ON projects(workspace_id);
CREATE INDEX idx_projects_status_id ON projects(status_id);
CREATE INDEX idx_stages_project_id ON stages(project_id);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_workspace_id ON tasks(workspace_id);
CREATE INDEX idx_tasks_status_id ON tasks(status_id);
CREATE INDEX idx_tasks_stage_id ON tasks(stage_id);
CREATE INDEX idx_tasks_schedule_id ON tasks(schedule_id);
CREATE INDEX idx_tasks_blocked_by_id ON tasks(blocked_by_id);
CREATE INDEX idx_custom_fields_workspace_id ON custom_fields(workspace_id);
CREATE INDEX idx_custom_field_values_custom_field_id ON custom_field_values(custom_field_id);
CREATE INDEX idx_custom_field_values_task_id ON custom_field_values(task_id);

-- +goose Down
DROP TABLE IF EXISTS custom_field_values;
DROP TABLE IF EXISTS custom_fields;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS stages;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS lables;
DROP TABLE IF EXISTS statuses;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS users;
