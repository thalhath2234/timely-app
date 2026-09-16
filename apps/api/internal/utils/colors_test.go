package utils

import "testing"

func TestStableColorForIDIsDeterministic(t *testing.T) {
	a := StableColorForID("prj_abc")
	b := StableColorForID("prj_abc")
	if a != b {
		t.Fatalf("expected stable color, got %q and %q", a, b)
	}
	if a == UnstagedColor {
		t.Fatal("hashed id should pick a palette color")
	}
}

func TestColorForIndexSkippingOmitsWorkspaceHue(t *testing.T) {
	skip := EntityColors[0]
	got := ColorForIndexSkipping(0, skip)
	if got == skip {
		t.Fatalf("first project should not reuse workspace color %q", skip)
	}
	if got != EntityColors[1] {
		t.Fatalf("got %q, want %q", got, EntityColors[1])
	}
}

func TestResolvedColorPrefersStoredHex(t *testing.T) {
	got := ResolvedColor("#e93d82", "prj_abc", 0)
	if got != "#E93D82" {
		t.Fatalf("got %q", got)
	}
}
