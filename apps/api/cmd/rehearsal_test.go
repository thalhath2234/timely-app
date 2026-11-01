package main

import (
	"testing"

	"timely-api/internal/features/schedule"
)

// previewSpy counts which kind of preview a schedule service was asked for.
type previewSpy struct {
	schedule.Service
	previews, dryRuns int
}

func (p *previewSpy) Preview(string, schedule.PlanRequest) (*schedule.PlanResponse, error) {
	p.previews++
	return &schedule.PlanResponse{}, nil
}

func (p *previewSpy) DryRun(string, schedule.PlanRequest) (*schedule.PlanResponse, error) {
	p.dryRuns++
	return &schedule.PlanResponse{}, nil
}

// A rehearsed proposal previews Auto-schedule as a dry run, which skips the
// traits hook: the hook writes outside the rolled-back transaction, before
// the person approves anything.
func TestRehearsedSchedulePreviewIsADryRun(t *testing.T) {
	spy := &previewSpy{}
	var s schedule.Service = rehearsedSchedule{spy}
	if _, err := s.Preview("usr_1", schedule.PlanRequest{}); err != nil {
		t.Fatal(err)
	}
	if spy.dryRuns != 1 || spy.previews != 0 {
		t.Fatalf("dry runs %d, previews %d", spy.dryRuns, spy.previews)
	}
}
