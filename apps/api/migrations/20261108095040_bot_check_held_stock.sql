-- +goose Up
-- A price rule on a shop page that fires while the product cannot be bought
-- is held: the check is logged as held_stock and nobody is told.
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_outcome_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_outcome_check CHECK (outcome IN ('baseline', 'unchanged', 'not_modified',
    'changed', 'fired', 'offline', 'rate_limited', 'site_busy', 'robots', 'strike', 'superseded', 'judged_quiet', 'passed',
    'held_stock'));

-- +goose Down
UPDATE bot_checks SET outcome = 'changed' WHERE outcome = 'held_stock';
ALTER TABLE bot_checks DROP CONSTRAINT bot_checks_outcome_check;
ALTER TABLE bot_checks ADD CONSTRAINT bot_checks_outcome_check CHECK (outcome IN ('baseline', 'unchanged', 'not_modified',
    'changed', 'fired', 'offline', 'rate_limited', 'site_busy', 'robots', 'strike', 'superseded', 'judged_quiet', 'passed'));
