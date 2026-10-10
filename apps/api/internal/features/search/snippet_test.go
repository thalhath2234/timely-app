package search

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSnippetDropsTitleAndCutsByCharacter(t *testing.T) {
	if got := snippet("Shop launch plan", "Shop launch plan\nPlan for the launch."); got != "Plan for the launch." {
		t.Fatalf("snippet = %q, want the text after the title", got)
	}
	if got := snippet("Notes", "Notes"); got != "" {
		t.Fatalf("title-only text = %q, want no snippet", got)
	}
	long := snippet("", strings.Repeat("é", 200))
	if !utf8.ValidString(long) || utf8.RuneCountInString(long) != 160 {
		t.Fatalf("long snippet = %d runes, valid %v", utf8.RuneCountInString(long), utf8.ValidString(long))
	}
}
