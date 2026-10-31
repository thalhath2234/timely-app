-- +goose Up
-- Announces every change to a chat on the channel timely_chats, so the API
-- can push it to the person's open apps (GET /chats/watch). The schema is in
-- the payload because APIs with their own DB_SCHEMA share the channel. Lease
-- renewals, which only keep a running chat claimed, are left out. NOTIFY is
-- delivered on commit, so rolled-back rehearsals send nothing.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_agent_conversation_change() RETURNS trigger AS $$
DECLARE
    changed agent_conversations;
BEGIN
    IF TG_OP = 'DELETE' THEN
        changed := OLD;
    ELSE
        changed := NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'lease' - 'lease_until' - 'updated_at') = (to_jsonb(OLD) - 'lease' - 'lease_until' - 'updated_at') THEN
        RETURN NULL;
    END IF;
    PERFORM pg_notify('timely_chats', json_build_object('schema', TG_TABLE_SCHEMA, 'user', changed.user_id, 'id', changed.id)::text);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER agent_conversations_notify
    AFTER INSERT OR UPDATE OR DELETE ON agent_conversations
    FOR EACH ROW EXECUTE FUNCTION notify_agent_conversation_change();

-- +goose Down
DROP TRIGGER IF EXISTS agent_conversations_notify ON agent_conversations;
DROP FUNCTION IF EXISTS notify_agent_conversation_change();
