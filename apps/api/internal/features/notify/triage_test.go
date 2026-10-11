package notify

import (
	"testing"

	"timely-api/internal/models"
)

// A repeating task's missed block only offers a lower priority: adding time
// or moving would change every occurrence.
func TestTriageFitsRepeatingMissedOnlyLowers(t *testing.T) {
	series := &models.Task{Kind: models.KindTask, Recurrence: &models.RecurrenceRule{RRule: "FREQ=DAILY"}}
	single := &models.Task{Kind: models.KindTask}
	for _, step := range []string{triageAddTime, triageMove, triageReschedule} {
		if triageFits(models.NotifyMissed, step, series) {
			t.Fatalf("%s fits a series", step)
		}
		if !triageFits(models.NotifyMissed, step, single) {
			t.Fatalf("%s does not fit one-off work", step)
		}
	}
	if !triageFits(models.NotifyMissed, triageLower, series) {
		t.Fatal("lower should fit a series")
	}
	if !triageFits(models.NotifyOverdue, triageExtend, series) {
		t.Fatal("overdue steps are not limited")
	}
}
