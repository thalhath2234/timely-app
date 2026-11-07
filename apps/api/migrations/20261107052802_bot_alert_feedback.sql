-- +goose Up
-- Useful and Not useful on a Bot's alerts (with why, when not useful), the
-- below/above rules that re-armed in a check ("Armed again, no alert"), and
-- the person's alert switches for new Bots ("Alerts for new bots").
-- The inline CHECK on feedback_reason is named bot_alerts_feedback_reason_check
-- by Postgres, so the rule tying reason and note to not_useful is
-- bot_alerts_feedback_shape_check.
ALTER TABLE bot_alerts
  ADD COLUMN feedback TEXT CHECK (feedback IN ('useful', 'not_useful')),
  ADD COLUMN feedback_reason TEXT NOT NULL DEFAULT '' CHECK (feedback_reason IN ('', 'too_small', 'not_wanted', 'already_knew')),
  ADD COLUMN feedback_note TEXT NOT NULL DEFAULT '' CHECK (char_length(feedback_note) <= 200),
  ADD COLUMN feedback_at TIMESTAMPTZ,
  ADD CONSTRAINT bot_alerts_feedback_at_check CHECK ((feedback IS NULL) = (feedback_at IS NULL)),
  ADD CONSTRAINT bot_alerts_feedback_shape_check CHECK (feedback = 'not_useful' OR (feedback_reason = '' AND feedback_note = ''));
ALTER TABLE bot_checks ADD COLUMN rearmed JSONB NOT NULL DEFAULT '[]';   -- [{watchId, ruleId, value, currency}] below/above rules that re-armed in this check
ALTER TABLE configs ADD COLUMN bot_alert_defaults JSONB NOT NULL
    DEFAULT '{"desktop": true, "phone": true, "urgent": false}';           -- "Alerts for new bots"

-- +goose Down
ALTER TABLE configs DROP COLUMN IF EXISTS bot_alert_defaults;
ALTER TABLE bot_checks DROP COLUMN IF EXISTS rearmed;
ALTER TABLE bot_alerts
  DROP CONSTRAINT IF EXISTS bot_alerts_feedback_shape_check,
  DROP CONSTRAINT IF EXISTS bot_alerts_feedback_at_check,
  DROP COLUMN IF EXISTS feedback_at,
  DROP COLUMN IF EXISTS feedback_note,
  DROP COLUMN IF EXISTS feedback_reason,
  DROP COLUMN IF EXISTS feedback;
