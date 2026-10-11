package suggest

import (
	"context"
	"testing"
)

func TestDocTemplateAsksNothingForAnUnnamedDoc(t *testing.T) {
	jev := &jevStub{answers: map[string]any{"template": choice("t1")}}
	s := New(nil, jev.service(t), nil)
	for _, title := range []string{"", " ", "a", "Untitled", " untitled "} {
		out := s.DocTemplate(context.Background(), "u1", title)
		if !out.Available || out.TemplateID != "" || out.LogID != "" {
			t.Fatalf("%q: %+v", title, out)
		}
	}
	if len(jev.requests) != 0 {
		t.Fatalf("asked %d times", len(jev.requests))
	}
}
