package decide

import "testing"

func TestRaiseOf(t *testing.T) {
	for _, c := range []struct {
		kept, decided int
		want          float64
	}{
		{0, 7, 0},          // too few answers to learn from
		{1, 8, raiseMore},  // kept 12%
		{3, 10, raiseSome}, // kept 30%
		{4, 10, 0},         // kept 40%
		{20, 20, 0},
	} {
		if got := raiseOf("clarify", c.kept, c.decided); got != c.want {
			t.Errorf("raiseOf(%d, %d) = %v, want %v", c.kept, c.decided, got, c.want)
		}
	}
}

func TestScreenTipsNeverRaise(t *testing.T) {
	if raiseOf("screen_tip", 0, 20) != 0 {
		t.Fatal("dismissed tips would switch tips off")
	}
}

func TestLearnedRaiseLiftsEveryReaderButAnyConfidence(t *testing.T) {
	a := Answers{answers: map[string]Answer{
		"pick":  {Kind: typeChoice, Choice: "b", Confidence: 0.7},
		"level": {Kind: typeScore, Level: 2, Confidence: 0.2},
		"yes":   {Kind: typeNoul, Yes: 0.9, Confidence: 0.8},
	}}
	if _, ok := a.Choice("pick", Prefill); !ok {
		t.Fatal("0.7 should pass Prefill without a raise")
	}
	a.raise = raiseSome
	if _, ok := a.Choice("pick", Prefill); ok {
		t.Fatal("raised Prefill (0.75) should refuse 0.7")
	}
	if _, ok := a.Level("level", 0); !ok {
		t.Fatal("a reader asking for any confidence is left alone")
	}
	if _, ok := a.Yes("yes", Flag); !ok {
		t.Fatal("raised Flag (0.65) should accept 0.8")
	}
	a.raise = raiseMore
	if got := a.need(Route); got != maxNeed {
		t.Fatalf("need(Route) = %v, want the %v cap", got, maxNeed)
	}
}
