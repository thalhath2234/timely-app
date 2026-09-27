package agent

import (
	"strings"
	"testing"

	"timely-api/internal/models"
)

func TestPrepareCreateTaskDefaultsWorkDuration(t *testing.T) {
	for _, tc := range []struct {
		name         string
		in           createTaskIn
		wantDuration int
	}{
		{"duration missing", createTaskIn{Name: "Bug", WorkspaceID: "ws_personal", StatusID: "todo", Description: "From Bugs doc"}, 30},
		{"scheduled work missing duration", createTaskIn{Name: "Bug", WorkspaceID: "ws_personal", ScheduleAt: "2026-09-28T12:00:00Z"}, 30},
		{"explicit duration", createTaskIn{Name: "Bug", WorkspaceID: "ws_personal", Duration: 45}, 45},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := prepareCreateTask(tc.in)
			if err != nil || got.Kind != models.KindTask || got.Duration != tc.wantDuration {
				t.Fatalf("prepared task = %+v, error = %v, want %d-minute work", got, err, tc.wantDuration)
			}
		})
	}
	for _, in := range []createTaskIn{{Name: "Bug"}, {Name: "Bug", Duration: 30}} {
		_, err := prepareCreateTask(in)
		if err == nil || !strings.Contains(err.Error(), "workspace") {
			t.Fatalf("error = %v, want workspace prompt", err)
		}
	}
}

func TestPrepareCreateTaskKeepsExplicitCaptureAndReminder(t *testing.T) {
	in, err := prepareCreateTask(createTaskIn{Name: "Thought", Kind: models.KindInbox})
	if err != nil || in.Kind != models.KindInbox || in.Duration != 0 {
		t.Fatalf("capture = %+v, %v", in, err)
	}
	in, err = prepareCreateTask(createTaskIn{Name: "Ping", Kind: models.KindReminder, ScheduleAt: "2026-09-28T12:00:00Z"})
	if err != nil || in.Kind != models.KindReminder || in.Duration != 0 {
		t.Fatalf("reminder = %+v, %v", in, err)
	}
}
