package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// Triage only narrows tools to an area it offered (GC11).
func TestTriageIgnoresAnAreaThatWasNotOffered(t *testing.T) {
	jev, _ := fakeJev(t, map[string]any{"area": choice("finance", 0.95)})
	s := &Service{}
	s.SetDecisions(jev)
	c := Conversation{UserID: "user-a", Messages: []Message{message("user", "hello"), message("assistant", "hi"), message("user", "what is on my calendar tomorrow?")}}
	tri, ok := s.triage(context.Background(), &c)
	if !ok || tri.area != "" || !tri.tools("get_calendar") {
		t.Fatalf("unknown area narrowed the tools: area %q", tri.area)
	}
	jev, _ = fakeJev(t, map[string]any{"area": choice("calendar", 0.95)})
	s.SetDecisions(jev)
	if tri, _ = s.triage(context.Background(), &c); tri.area != "calendar" {
		t.Fatalf("offered area dropped: %q", tri.area)
	}
}

// resolve_target looks a name up once per run and stops after a few
// lookups, so one message cannot fan out into many paid calls (GC16).
func TestTargetLookupsAreReusedAndCapped(t *testing.T) {
	var l targetLookups
	calls := 0
	look := func() (any, *targetPick, error) { calls++; return map[string]any{"n": calls}, nil, nil }
	args := func(name string) json.RawMessage { return raw(map[string]string{"kind": "task", "name": name}) }
	first, _, _ := l.resolve(args("Dentist visit"), look)
	again, _, _ := l.resolve(args("  dentist   VISIT "), look)
	if calls != 1 || string(raw(first)) != string(raw(again)) {
		t.Fatalf("the same name was looked up %d times", calls)
	}
	for i := 0; i < maxTargetLookups+2; i++ {
		_, _, _ = l.resolve(args(fmt.Sprintf("item %d", i)), look)
	}
	if calls != maxTargetLookups {
		t.Fatalf("%d lookups in one run, want at most %d", calls, maxTargetLookups)
	}
	if _, _, err := l.resolve(args("one more"), look); err == nil || !strings.Contains(err.Error(), "ask the person") {
		t.Fatalf("over the cap: %v", err)
	}
}
