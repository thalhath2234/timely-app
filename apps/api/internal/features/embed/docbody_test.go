package embed

import (
	"testing"
	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

func TestDocBodyPutsPropertiesFirst(t *testing.T) {
	content, plain := richtext.FromMarkdown("---\ntags: travel, 2026\nstatus: draft\n---\n\nBook flights.")
	got := DocBody(&models.Document{Content: content, PlainText: plain})
	if got != "Properties: tags: travel, 2026; status: draft\n\nBook flights." {
		t.Fatalf("got %q (plain %q)", got, plain)
	}
	content, plain = richtext.FromMarkdown("Just text.")
	if got := DocBody(&models.Document{Content: content, PlainText: plain}); got != "Just text." {
		t.Fatalf("got %q", got)
	}
}
