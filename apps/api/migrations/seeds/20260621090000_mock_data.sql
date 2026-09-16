-- +goose Up
-- Seed data for local testing:
-- 1 user, 2 workspaces, 2 projects per workspace, 5 tasks per project (20 total).
-- Login: thalhathva2@gmail.com / 12341234

INSERT INTO users (id, email, password, created_at, updated_at)
VALUES
    ('usr_seed_01', 'thalhathva2@gmail.com', '$2a$10$Tnje59vzgrzQUJi/bkWAFuN4RuVcpXSkN0Mzx/FYdONfu.fvlYcgS', '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO configs (id, user_id, is_on_boarding_completed, created_at, updated_at)
VALUES
    ('cfg_seed_01', 'usr_seed_01', TRUE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, name, user_id, created_at, updated_at)
VALUES
    ('ws_seed_eng', 'Engineering Workspace', 'usr_seed_01', '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('ws_seed_mkt', 'Marketing Workspace', 'usr_seed_01', '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO statuses (id, name, color, workspace_id, is_default, created_at, updated_at)
VALUES
    ('st_eng_todo', 'Todo', '#889096', 'ws_seed_eng', TRUE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('st_eng_inprog', 'In Progress', '#FFB224', 'ws_seed_eng', FALSE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('st_eng_done', 'Completed', '#30A66D', 'ws_seed_eng', FALSE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('st_eng_blocked', 'Blocked', '#E5484D', 'ws_seed_eng', FALSE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('st_mkt_todo', 'Todo', '#889096', 'ws_seed_mkt', TRUE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('st_mkt_inprog', 'In Progress', '#FFB224', 'ws_seed_mkt', FALSE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('st_mkt_done', 'Completed', '#30A66D', 'ws_seed_mkt', FALSE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('st_mkt_blocked', 'Blocked', '#E5484D', 'ws_seed_mkt', FALSE, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (
    id, title, description, status_id, deadline, start_date, completed_at,
    priority_level, color, does_have_stages, workspace_id, created_at, updated_at
)
VALUES
    ('prj_eng_api', 'API Refactor', 'Refactor auth and task APIs', 'st_eng_inprog', '2026-07-10', '2026-06-22', NULL, 'high', '#1F6FEB', FALSE, 'ws_seed_eng', '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('prj_eng_mobile', 'Mobile SDK', 'Build first internal mobile SDK', 'st_eng_todo', '2026-08-01', '2026-06-25', NULL, 'medium', '#0EA5E9', FALSE, 'ws_seed_eng', '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('prj_mkt_q3', 'Q3 Campaign', 'Launch Q3 acquisition campaign', 'st_mkt_inprog', '2026-07-20', '2026-06-23', NULL, 'high', '#F97316', FALSE, 'ws_seed_mkt', '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('prj_mkt_content', 'Content Engine', 'Build weekly content pipeline', 'st_mkt_todo', '2026-08-15', '2026-06-24', NULL, 'low', '#14B8A6', FALSE, 'ws_seed_mkt', '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO custom_fields (id, name, workspace_id, created_at, updated_at, type, options)
VALUES
    (
        'cf_eng_severity',
        'Severity',
        'ws_seed_eng',
        '2026-06-21T09:00:00Z',
        '2026-06-21T09:00:00Z',
        'select',
        '{"options":[{"id":"opt_sev_low","value":"Low","color":"#22C55E"},{"id":"opt_sev_med","value":"Medium","color":"#F59E0B"},{"id":"opt_sev_high","value":"High","color":"#EF4444"}]}'::jsonb
    ),
    (
        'cf_eng_component',
        'Component',
        'ws_seed_eng',
        '2026-06-21T09:00:00Z',
        '2026-06-21T09:00:00Z',
        'multi_select',
        '{"options":[{"id":"opt_cmp_backend","value":"Backend","color":"#3B82F6"},{"id":"opt_cmp_frontend","value":"Frontend","color":"#8B5CF6"},{"id":"opt_cmp_infra","value":"Infra","color":"#06B6D4"}]}'::jsonb
    ),
    (
        'cf_mkt_channel',
        'Channel',
        'ws_seed_mkt',
        '2026-06-21T09:00:00Z',
        '2026-06-21T09:00:00Z',
        'select',
        '{"options":[{"id":"opt_chn_email","value":"Email","color":"#0EA5E9"},{"id":"opt_chn_social","value":"Social","color":"#F97316"},{"id":"opt_chn_seo","value":"SEO","color":"#22C55E"}]}'::jsonb
    ),
    (
        'cf_mkt_region',
        'Region',
        'ws_seed_mkt',
        '2026-06-21T09:00:00Z',
        '2026-06-21T09:00:00Z',
        'select',
        '{"options":[{"id":"opt_reg_na","value":"North America","color":"#6366F1"},{"id":"opt_reg_eu","value":"Europe","color":"#A855F7"},{"id":"opt_reg_apac","value":"APAC","color":"#14B8A6"}]}'::jsonb
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (
    id, name, description, duration, deadline, start_date, scheduled_on, completed_at,
    created_at, updated_at, project_id, status_id, priority_level, workspace_id, user_id
)
VALUES
    ('tsk_eng_api_01', 'Design auth token refresh flow', 'Write token lifecycle RFC and edge cases', 120, '2026-06-27', '2026-06-22', '2026-06-22T10:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_api', 'st_eng_inprog', 'high', 'ws_seed_eng', 'usr_seed_01'),
    ('tsk_eng_api_02', 'Implement refresh endpoint', 'Add /auth/refresh and rotate refresh tokens', 180, '2026-06-29', '2026-06-23', '2026-06-23T11:30:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_api', 'st_eng_todo', 'high', 'ws_seed_eng', 'usr_seed_01'),
    ('tsk_eng_api_03', 'Refactor middleware', 'Centralize permission checks', 90, '2026-07-01', '2026-06-24', '2026-06-24T14:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_api', 'st_eng_inprog', 'medium', 'ws_seed_eng', 'usr_seed_01'),
    ('tsk_eng_api_04', 'Write integration tests', 'Cover happy path and invalid token scenarios', 150, '2026-07-02', '2026-06-25', '2026-06-25T09:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_api', 'st_eng_todo', 'medium', 'ws_seed_eng', 'usr_seed_01'),
    ('tsk_eng_api_05', 'Ship API refactor v1', 'Release to staging and monitor logs', 60, '2026-07-03', '2026-06-26', '2026-06-26T16:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_api', 'st_eng_blocked', 'low', 'ws_seed_eng', 'usr_seed_01'),

    ('tsk_eng_mobile_01', 'Define SDK API surface', 'List first-class methods and error contracts', 60, '2026-07-05', '2026-06-25', '2026-06-25T10:00:00Z', '2026-06-25T12:00:00Z', '2026-06-21T09:00:00Z', '2026-06-26T12:00:00Z', 'prj_eng_mobile', 'st_eng_done', 'medium', 'ws_seed_eng', 'usr_seed_01'),
    ('tsk_eng_mobile_02', 'Build auth client', 'Implement login and refresh wrappers', 120, '2026-07-08', '2026-06-26', '2026-06-26T13:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_mobile', 'st_eng_inprog', 'high', 'ws_seed_eng', 'usr_seed_01'),
    ('tsk_eng_mobile_03', 'Implement retries', 'Add retry and backoff strategy', 90, '2026-07-09', '2026-06-27', '2026-06-27T15:30:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_mobile', 'st_eng_todo', 'medium', 'ws_seed_eng', 'usr_seed_01'),
    ('tsk_eng_mobile_04', 'Generate docs', 'Auto-generate API docs from code comments', 60, '2026-07-10', '2026-06-28', '2026-06-28T09:30:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_mobile', 'st_eng_todo', 'low', 'ws_seed_eng', 'usr_seed_01'),
    ('tsk_eng_mobile_05', 'Publish beta package', 'Push beta package to internal registry', 30, '2026-07-11', '2026-06-29', '2026-06-29T17:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_eng_mobile', 'st_eng_blocked', 'high', 'ws_seed_eng', 'usr_seed_01'),

    ('tsk_mkt_q3_01', 'Audience segmentation', 'Create ICP segments and targeting rules', 90, '2026-06-30', '2026-06-23', '2026-06-23T10:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_q3', 'st_mkt_inprog', 'high', 'ws_seed_mkt', 'usr_seed_01'),
    ('tsk_mkt_q3_02', 'Ad copy draft', 'Draft 10 copy variants for paid social', 60, '2026-07-01', '2026-06-24', '2026-06-24T11:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_q3', 'st_mkt_todo', 'medium', 'ws_seed_mkt', 'usr_seed_01'),
    ('tsk_mkt_q3_03', 'Landing page wireframe', 'Prepare wireframe and CTA experiments', 120, '2026-07-02', '2026-06-25', '2026-06-25T14:30:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_q3', 'st_mkt_inprog', 'high', 'ws_seed_mkt', 'usr_seed_01'),
    ('tsk_mkt_q3_04', 'Campaign budget plan', 'Allocate spend by region and channel', 60, '2026-07-03', '2026-06-26', '2026-06-26T09:00:00Z', '2026-06-26T10:30:00Z', '2026-06-21T09:00:00Z', '2026-06-26T10:30:00Z', 'prj_mkt_q3', 'st_mkt_done', 'medium', 'ws_seed_mkt', 'usr_seed_01'),
    ('tsk_mkt_q3_05', 'Launch checklist', 'Finalize tracking and QA checklist', 90, '2026-07-04', '2026-06-27', '2026-06-27T16:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_q3', 'st_mkt_blocked', 'low', 'ws_seed_mkt', 'usr_seed_01'),

    ('tsk_mkt_cnt_01', 'Editorial calendar', 'Create 6-week editorial calendar', 60, '2026-07-06', '2026-06-24', '2026-06-24T10:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_content', 'st_mkt_todo', 'medium', 'ws_seed_mkt', 'usr_seed_01'),
    ('tsk_mkt_cnt_02', 'SEO keyword cluster', 'Group keywords by intent and topic', 150, '2026-07-07', '2026-06-25', '2026-06-25T13:30:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_content', 'st_mkt_inprog', 'high', 'ws_seed_mkt', 'usr_seed_01'),
    ('tsk_mkt_cnt_03', 'Template design', 'Design reusable long-form template', 90, '2026-07-08', '2026-06-26', '2026-06-26T15:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_content', 'st_mkt_todo', 'low', 'ws_seed_mkt', 'usr_seed_01'),
    ('tsk_mkt_cnt_04', 'Writer onboarding', 'Onboard 3 freelance writers', 60, '2026-07-09', '2026-06-27', '2026-06-27T11:30:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_content', 'st_mkt_blocked', 'medium', 'ws_seed_mkt', 'usr_seed_01'),
    ('tsk_mkt_cnt_05', 'Publish first article batch', 'Publish first 4 articles and monitor CTR', 120, '2026-07-10', '2026-06-28', '2026-06-28T17:00:00Z', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z', 'prj_mkt_content', 'st_mkt_todo', 'high', 'ws_seed_mkt', 'usr_seed_01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO custom_field_values (id, custom_field_id, task_id, options_value, type, string_value, created_at, updated_at)
VALUES
    ('cfv_01', 'cf_eng_severity', 'tsk_eng_api_01', '{"options":[{"id":"opt_sev_high","value":"High","color":"#EF4444"}]}'::jsonb, 'select', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('cfv_02', 'cf_eng_component', 'tsk_eng_api_01', '{"options":[{"id":"opt_cmp_backend","value":"Backend","color":"#3B82F6"},{"id":"opt_cmp_infra","value":"Infra","color":"#06B6D4"}]}'::jsonb, 'multi_select', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('cfv_03', 'cf_mkt_channel', 'tsk_mkt_q3_01', '{"options":[{"id":"opt_chn_social","value":"Social","color":"#F97316"}]}'::jsonb, 'select', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z'),
    ('cfv_04', 'cf_mkt_region', 'tsk_mkt_q3_01', '{"options":[{"id":"opt_reg_eu","value":"Europe","color":"#A855F7"}]}'::jsonb, 'select', NULL, '2026-06-21T09:00:00Z', '2026-06-21T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- +goose Down
DELETE FROM custom_field_values WHERE id IN ('cfv_01', 'cfv_02', 'cfv_03', 'cfv_04');

DELETE FROM tasks WHERE id IN (
    'tsk_eng_api_01', 'tsk_eng_api_02', 'tsk_eng_api_03', 'tsk_eng_api_04', 'tsk_eng_api_05',
    'tsk_eng_mobile_01', 'tsk_eng_mobile_02', 'tsk_eng_mobile_03', 'tsk_eng_mobile_04', 'tsk_eng_mobile_05',
    'tsk_mkt_q3_01', 'tsk_mkt_q3_02', 'tsk_mkt_q3_03', 'tsk_mkt_q3_04', 'tsk_mkt_q3_05',
    'tsk_mkt_cnt_01', 'tsk_mkt_cnt_02', 'tsk_mkt_cnt_03', 'tsk_mkt_cnt_04', 'tsk_mkt_cnt_05'
);

DELETE FROM custom_fields WHERE id IN ('cf_eng_severity', 'cf_eng_component', 'cf_mkt_channel', 'cf_mkt_region');

DELETE FROM projects WHERE id IN ('prj_eng_api', 'prj_eng_mobile', 'prj_mkt_q3', 'prj_mkt_content');

DELETE FROM statuses WHERE id IN (
    'st_eng_todo', 'st_eng_inprog', 'st_eng_done', 'st_eng_blocked',
    'st_mkt_todo', 'st_mkt_inprog', 'st_mkt_done', 'st_mkt_blocked'
);

DELETE FROM workspaces WHERE id IN ('ws_seed_eng', 'ws_seed_mkt');
DELETE FROM configs WHERE id = 'cfg_seed_01';
DELETE FROM users WHERE id = 'usr_seed_01';
