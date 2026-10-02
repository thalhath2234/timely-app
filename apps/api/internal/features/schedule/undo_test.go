package schedule

import (
	"encoding/json"
	"testing"

	"timely-api/internal/models"
)

func TestUndoCoversTasksThatHadNoBlocksBefore(t *testing.T) {
	// A first auto-schedule stores no earlier blocks; undo must still clear
	// the blocks it added for every task it scheduled.
	raw, _ := json.Marshal(revisionSnapshot{Blocks: []models.ScheduledBlock{{TaskID: "tsk_b"}}, TaskIDs: []string{"tsk_a", "tsk_b"}})
	snapshot, ids, err := decodeRevision(raw)
	if err != nil || len(snapshot.Blocks) != 1 || len(ids) != 2 || ids[0] != "tsk_a" || ids[1] != "tsk_b" {
		t.Fatalf("ids=%v blocks=%d err=%v", ids, len(snapshot.Blocks), err)
	}
	// Revisions saved before taskIds existed are a plain block array.
	legacy, _ := json.Marshal([]models.ScheduledBlock{{TaskID: "tsk_c"}})
	snapshot, ids, err = decodeRevision(legacy)
	if err != nil || len(snapshot.Blocks) != 1 || len(ids) != 1 || ids[0] != "tsk_c" {
		t.Fatalf("legacy ids=%v err=%v", ids, err)
	}
	empty, _ := json.Marshal([]models.ScheduledBlock{})
	if snapshot, ids, err = decodeRevision(empty); err != nil || snapshot.Blocks == nil || len(ids) != 0 {
		t.Fatalf("empty revision: %v %v", ids, err)
	}
}
