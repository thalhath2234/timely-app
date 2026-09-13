package apikey

import "testing"

func TestHashKeyStableAndDistinct(t *testing.T) {
	a := hashKey("tk_abc")
	b := hashKey("tk_abc")
	c := hashKey("tk_other")
	if a == "" || a != b {
		t.Fatalf("hash should be stable, got %q and %q", a, b)
	}
	if a == c {
		t.Fatal("different keys should not hash the same")
	}
}

func TestRandomKeyPrefix(t *testing.T) {
	key, err := randomKey()
	if err != nil {
		t.Fatal(err)
	}
	if len(key) < 10 || key[:3] != "tk_" {
		t.Fatalf("unexpected key %q", key)
	}
}
