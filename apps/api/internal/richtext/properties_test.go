package richtext

import (
	"reflect"
	"testing"
)

func TestParseProperties(t *testing.T) {
	got := ParseProperties("title: Trip plan\ntags: travel, 2026\nstatus: \"draft\" # wip\nlinks: [a, 'b c']\naliases:\n  - Japan trip\n  - Spring\nempty:\nnot a property\n")
	want := []Property{
		{Key: "title", Values: []string{"Trip plan"}},
		{Key: "tags", Values: []string{"travel", "2026"}},
		{Key: "status", Values: []string{"draft"}},
		{Key: "links", Values: []string{"a", "b c"}},
		{Key: "aliases", Values: []string{"Japan trip", "Spring"}},
		{Key: "empty"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v", got)
	}
	if line := DescribeProperties(got); line != "title: Trip plan; tags: travel, 2026; status: draft; links: a, b c; aliases: Japan trip, Spring" {
		t.Fatalf("describe: %q", line)
	}
}

func TestFrontmatter(t *testing.T) {
	doc, _ := FromMarkdown("---\ntags: a, b\n---\n\n# Hi")
	if got := Frontmatter(doc); got != "tags: a, b" {
		t.Fatalf("got %q", got)
	}
	plain, _ := FromMarkdown("# Hi")
	if got := Frontmatter(plain); got != "" {
		t.Fatalf("got %q", got)
	}
}
