package agent

import (
	"context"
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
