-- +goose Up
-- A phone's push token belongs to the sign-in that registered it: signing
-- that session out (logout, the Sessions list, "sign out others") removes
-- the device, so a lost phone stops getting pushes. Rows from before this
-- have no session and get no push until the phone registers again, which it
-- does at every start.
ALTER TABLE push_devices ADD COLUMN session_id TEXT REFERENCES user_sessions(id) ON DELETE CASCADE;
CREATE INDEX idx_push_devices_session ON push_devices (session_id);
-- +goose Down
DROP INDEX IF EXISTS idx_push_devices_session;
ALTER TABLE push_devices DROP COLUMN session_id;
