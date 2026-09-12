package models

import "testing"
import "time"

func TestInQuietHoursSameDay(t *testing.T) {
	s := NotificationSettings{QuietHoursStart: "22:00", QuietHoursEnd: "07:00"}
	late := time.Date(2026, 9, 12, 23, 0, 0, 0, time.UTC)
	early := time.Date(2026, 9, 13, 6, 30, 0, 0, time.UTC)
	day := time.Date(2026, 9, 13, 10, 0, 0, 0, time.UTC)
	if !s.InQuietHours(late) || !s.InQuietHours(early) {
		t.Fatal("overnight window should be quiet")
	}
	if s.InQuietHours(day) {
		t.Fatal("late morning should not be quiet")
	}
}

func TestInQuietHoursEmpty(t *testing.T) {
	s := NotificationSettings{}
	now := time.Date(2026, 9, 12, 23, 0, 0, 0, time.UTC)
	if s.InQuietHours(now) {
		t.Fatal("empty window is never quiet")
	}
}

func TestNotificationSettingsScanDefaults(t *testing.T) {
	var s NotificationSettings
	if err := s.Scan("{}"); err != nil {
		t.Fatal(err)
	}
	if !s.Reminders || !s.DigestMorning || s.MorningDigestAt != "08:00" {
		t.Fatalf("%+v", s)
	}
}
