package notify

import (
	"testing"
	"time"

	_ "time/tzdata"

	"timely-api/internal/models"
)

// Quiet hours hold an alert until they end, unless it is urgent.
func TestQuietUntil(t *testing.T) {
	kolkata, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		t.Fatal(err)
	}
	quiet := models.NotificationSettings{QuietHoursStart: "22:00", QuietHoursEnd: "07:00"}
	night := time.Date(2026, 11, 6, 20, 44, 0, 0, time.UTC) // 02:14 on 7 Nov in Kolkata
	end, held := QuietUntil(quiet, kolkata, AlertOptions{Now: night})
	if want := time.Date(2026, 11, 7, 7, 0, 0, 0, kolkata); !held || !end.Equal(want) {
		t.Fatalf("QuietUntil = %v %v, want %v", end, held, want)
	}
	if _, held := QuietUntil(quiet, kolkata, AlertOptions{Now: night, Urgent: true}); held {
		t.Fatal("an urgent alert was held")
	}
	day := time.Date(2026, 11, 6, 6, 30, 0, 0, time.UTC) // 12:00 in Kolkata
	if _, held := QuietUntil(quiet, kolkata, AlertOptions{Now: day}); held {
		t.Fatal("a daytime alert was held")
	}
	if _, held := QuietUntil(models.NotificationSettings{}, kolkata, AlertOptions{Now: night}); held {
		t.Fatal("no quiet hours held an alert")
	}
}
