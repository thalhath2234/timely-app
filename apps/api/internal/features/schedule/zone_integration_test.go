package schedule

import (
	"testing"
	"time"

	"timely-api/internal/features/event"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
)

// With no saved Working hours the zone is the server's, which Go names "Local".
// That name must not leave the process: plan responses and the free-time call
// carry an IANA name or none, and "" still resolves to the server's zone.
func TestIntegrationServerZoneIsNeverNamedLocalInPlans(t *testing.T) {
	db, place, _ := freeTimeFixture(t)
	if err := db.Model(&models.Config{}).Where("user_id = ?", freeTimeUser).Update("working_hours", models.WorkingHours{}).Error; err != nil {
		t.Fatal(err)
	}
	prev := time.Local
	t.Cleanup(func() { time.Local = prev })
	time.Local = time.FixedZone("Local", 9*60*60)
	t.Setenv("TZ", "")

	service := NewService(NewRepository(db), task.NewTaskRepository(db), event.NewEventRepository(db), place)
	plan, err := service.Preview(freeTimeUser, PlanRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Timezone == "Local" {
		t.Fatalf("plan timezone = %q", plan.Timezone)
	}
	hours, err := service.GetWorkingHours(freeTimeUser, "")
	if err != nil || hours.Timezone != "" {
		t.Fatalf("default hours timezone = %q (err %v), want none", hours.Timezone, err)
	}
	now := time.Now()
	if _, err := service.FreeTime(freeTimeUser, now, now.AddDate(0, 0, 3), ""); err != nil {
		t.Fatalf("free time with no zone: %v", err)
	}
}
