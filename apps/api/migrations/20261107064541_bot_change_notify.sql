-- +goose Up
-- Announces every write to a Bot, its watches, alerts and lessons on the
-- channel timely_bots, so the API can push it to the person's open apps
-- (GET /bots/watch). Checks run on worker lanes in any API process, which is
-- why the database, not the process, announces them. The schema is in the
-- payload because APIs with their own DB_SCHEMA share the channel. Nothing
-- is filtered: a claim (check_started_at) is how apps show "Checking…", and
-- they batch the events. NOTIFY is delivered on commit, so rolled-back
-- rehearsals send nothing. The row is read through to_jsonb because the
-- function serves four tables: naming r.bot_id would fail on bots rows.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_bot_change() RETURNS trigger AS $$
DECLARE
    j jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        j := to_jsonb(OLD);
    ELSE
        j := to_jsonb(NEW);
    END IF;
    PERFORM pg_notify('timely_bots', json_build_object('schema', TG_TABLE_SCHEMA, 'user', j->>'user_id',
        'id', COALESCE(j->>'bot_id', j->>'id'))::text);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER bots_notify AFTER INSERT OR UPDATE OR DELETE ON bots
    FOR EACH ROW EXECUTE FUNCTION notify_bot_change();
CREATE TRIGGER bot_watches_notify AFTER INSERT OR UPDATE OR DELETE ON bot_watches
    FOR EACH ROW EXECUTE FUNCTION notify_bot_change();
CREATE TRIGGER bot_alerts_notify AFTER INSERT OR UPDATE OR DELETE ON bot_alerts
    FOR EACH ROW EXECUTE FUNCTION notify_bot_change();
CREATE TRIGGER bot_lessons_notify AFTER INSERT OR UPDATE OR DELETE ON bot_lessons
    FOR EACH ROW EXECUTE FUNCTION notify_bot_change();

-- +goose Down
DROP TRIGGER IF EXISTS bot_lessons_notify ON bot_lessons;
DROP TRIGGER IF EXISTS bot_alerts_notify ON bot_alerts;
DROP TRIGGER IF EXISTS bot_watches_notify ON bot_watches;
DROP TRIGGER IF EXISTS bots_notify ON bots;
DROP FUNCTION IF EXISTS notify_bot_change();
