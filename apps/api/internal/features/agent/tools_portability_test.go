package agent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// GB1: restore_account needed only confirm=true, while the app's restore
// also needs an explicit replace step. Both are required now, before the
// backup is even looked at.
func TestRestoreAccountNeedsTheReplaceStep(t *testing.T) {
	s := &Server{}
	backup := map[string]any{"format": "timely-backup", "schemaVersion": 2, "rows": map[string]any{}}
	for name, in := range map[string]restoreIn{
		"no confirm": {Mode: "replace", Backup: backup},
		"no mode":    {Confirm: true, Backup: backup},
		"wrong mode": {Confirm: true, Mode: "merge", Backup: backup},
	} {
		_, _, err := s.restoreAccount(context.Background(), nil, in)
		if err == nil {
			t.Fatalf("%s: restore went ahead", name)
		}
		if name != "no confirm" && !strings.Contains(err.Error(), `mode="replace"`) {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

// download_backup gives an outside app a stored backup without what Timely
// learned: no agent zip and no learning rows, the person's other rows whole.
func TestDownloadBackupLeavesOutWhatTimelyLearned(t *testing.T) {
	plain := []byte(`{"format":"timely-backup","schemaVersion":3,"agent":{"zip":"UEsDBA=="},` +
		`"rows":{"workspaces":[{"id":"w1"}],"agent_learning_events":[{"id":"e1","after":"Has a cardiology appointment"}],` +
		`"agent_learning_settings":[{"id":"u1"}]}}`)
	got, err := outsideDownload(plain)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(got)
	if strings.Contains(string(raw), "cardiology") || strings.Contains(string(raw), `"agent"`) ||
		strings.Contains(string(raw), "agent_learning") || !strings.Contains(string(raw), `"w1"`) {
		t.Fatalf("outside download %s", raw)
	}
}
