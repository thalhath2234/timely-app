package richtext

import (
	"reflect"
	"testing"
)

func TestLinkSnippets(t *testing.T) {
	doc, _ := FromMarkdown("See [@Plan](timely://doc/doc_1) today.\n\n- In a list [[the plan#Goals|goals]]\n\nNothing here.\n\n[Other](timely://doc/doc_2)\n")
	got := LinkSnippets(doc, "doc_1", "The Plan")
	want := []string{"See @Plan today.", "In a list goals"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
	if len(LinkSnippets(doc, "doc_3", "Missing")) != 0 {
		t.Fatal("found a link that is not there")
	}
}
