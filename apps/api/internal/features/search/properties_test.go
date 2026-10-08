package search

import (
	"reflect"
	"regexp"
	"testing"
)

func TestSplitQuery(t *testing.T) {
	rest, filters := splitQuery(`trip status:draft owner:"Sam Lee" see https://x.io notes`)
	if rest != "trip see https://x.io notes" {
		t.Fatalf("rest %q", rest)
	}
	want := []propertyFilter{{Key: "status", Value: "draft"}, {Key: "owner", Value: "Sam Lee"}}
	if !reflect.DeepEqual(filters, want) {
		t.Fatalf("filters %#v", filters)
	}
}

func TestPropertyPattern(t *testing.T) {
	text := "title: Trip plan\ntags: travel, 2026\naliases:\n  - Japan trip\n  - Spring\nstatus: draft"
	cases := map[propertyFilter]bool{
		{Key: "tags", Value: "travel"}:    true,
		{Key: "status", Value: "DRAFT"}:   true,
		{Key: "aliases", Value: "japan"}:  true,
		{Key: "aliases", Value: "spring"}: true,
		{Key: "status", Value: "done"}:    false,
		{Key: "tags", Value: "plan"}:      false,
		{Key: "owner", Value: "x"}:        false,
	}
	for f, want := range cases {
		// Postgres ~* is case-insensitive; Go needs (?i).
		if got := regexp.MustCompile("(?i)" + f.pattern()).MatchString(text); got != want {
			t.Errorf("%s:%s = %v", f.Key, f.Value, got)
		}
	}
}
