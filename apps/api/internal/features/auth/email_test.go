package auth

import "testing"

func TestNormalizeEmail(t *testing.T) {
	if got := NormalizeEmail("  Foo.Bar@Example.COM "); got != "foo.bar@example.com" {
		t.Fatalf("got %q", got)
	}
}

func TestValidateEmail(t *testing.T) {
	if !ValidateEmail("user@example.com") {
		t.Fatal("expected valid")
	}
	if ValidateEmail("not-an-email") || ValidateEmail("") {
		t.Fatal("expected invalid")
	}
}
