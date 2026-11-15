package main

import (
	"database/sql"
	"strings"
	"testing"
	"time"
)

func TestAuditHostEvents(t *testing.T) {
	at := time.Now()
	ev := func(kind, chat, call, tool, hash, reason, status string) HostEvent {
		at = at.Add(time.Millisecond)
		return HostEvent{ConversationID: chat, ToolCallID: call, Tool: tool, ArgsHash: hash, Kind: kind, Reason: reason, Status: status, At: at}
	}
	cases := []struct {
		name string
		evs  []HostEvent
		bad  int
	}{
		{"approved then ran", []HostEvent{ev("approved", "c", "k1", "terminal", "h", "", ""), ev("ran", "c", "k1", "terminal", "h", "", "ok")}, 0},
		{"allowed then ran", []HostEvent{ev("allowed", "c", "k1", "terminal", "h", "Auto", ""), ev("ran", "c", "k1", "terminal", "h", "", "ok")}, 0},
		{"ran alone", []HostEvent{ev("ran", "c", "k1", "terminal", "h", "", "ok")}, 1},
		{"denied then ran", []HostEvent{ev("denied", "c", "k1", "terminal", "h", "", ""), ev("ran", "c", "k1", "terminal", "h", "", "ok")}, 1},
		{"blocked report needs no approval", []HostEvent{ev("ran", "c", "k1", "terminal", "h", "", "blocked")}, 0},
		{"one approval, two runs", []HostEvent{ev("approved", "c", "k1", "terminal", "h", "", ""), ev("ran", "c", "k1", "terminal", "h", "", "ok"), ev("ran", "c", "k1", "terminal", "h", "", "ok")}, 1},
		{"another chat's approval", []HostEvent{ev("approved", "d", "k1", "terminal", "h", "", ""), ev("ran", "c", "k1", "terminal", "h", "", "ok")}, 1},
		{"continuation by tool and arguments", []HostEvent{ev("allowed", "c", "k1", "terminal", "h", "continuation of an approved parked card", ""), ev("ran", "c", "k2", "terminal", "h", "", "ok")}, 0},
		{"continuation, other arguments", []HostEvent{ev("allowed", "c", "k1", "terminal", "h", "continuation of an approved parked card", ""), ev("ran", "c", "k2", "terminal", "g", "", "ok")}, 1},
	}
	for _, c := range cases {
		if got := AuditHostEvents(c.evs); len(got) != c.bad {
			t.Errorf("%s: %v, want %d violations", c.name, got, c.bad)
		}
	}
}

func TestAuditHostLanes(t *testing.T) {
	until := sql.NullTime{Time: time.Now(), Valid: true}
	got := AuditHostLanes([]HostLaneRow{
		{ID: "a", Status: "host_approval"},
		{ID: "b", Status: "host_approval", Lease: "lease_x"},
		{ID: "c", Status: "host_approval", LeaseUntil: until},
		{ID: "d", Status: "running", Lease: "lease_y", LeaseUntil: until},
	})
	if len(got) != 2 || !strings.Contains(got[0], "b") || !strings.Contains(got[1], "c") {
		t.Fatalf("violations %v", got)
	}
}

func TestHostAuditReportReadsAsAVerdict(t *testing.T) {
	ok := HostAuditReport{Events: 3, Ran: 1, ByKind: map[string]int{"approved": 1, "ran": 1, "requested": 1}}.String()
	if !strings.Contains(ok, "PASS") || strings.Contains(ok, "VIOLATION") {
		t.Fatalf("report %q", ok)
	}
	bad := HostAuditReport{ByKind: map[string]int{}, Violations: []string{"chat c: terminal call k ran"}}.String()
	if strings.Contains(bad, "PASS") || !strings.Contains(bad, "VIOLATION: chat c") {
		t.Fatalf("report %q", bad)
	}
}
