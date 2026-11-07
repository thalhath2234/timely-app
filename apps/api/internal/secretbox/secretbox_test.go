package secretbox

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func box(t *testing.T, label string) *Box {
	t.Helper()
	b, err := New(label)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestRoundTrip(t *testing.T) {
	t.Setenv("TIMELY_BACKUP_KEY", "backup-secret")
	b := box(t, "timely-bot-source:")
	sealed, err := b.Seal("d4k3yabc1234")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "d4k3yabc1234") {
		t.Fatal("the sealed value carries the key")
	}
	again, _ := b.Seal("d4k3yabc1234")
	if again == sealed {
		t.Fatal("two seals of one value are equal: the nonce is not fresh")
	}
	for _, s := range []string{sealed, again} {
		if got, err := b.Open(s); err != nil || got != "d4k3yabc1234" {
			t.Fatalf("Open = %q, %v", got, err)
		}
	}
	if got, err := b.Open(""); err != nil || got != "" {
		t.Fatalf("Open(\"\") = %q, %v", got, err)
	}
}

func TestTamper(t *testing.T) {
	t.Setenv("TIMELY_BACKUP_KEY", "backup-secret")
	b := box(t, "timely-bot-source:")
	sealed, _ := b.Seal("d4k3yabc1234")
	raw, _ := base64.StdEncoding.DecodeString(sealed)
	raw[len(raw)-1] ^= 1
	for _, bad := range []string{base64.StdEncoding.EncodeToString(raw), "not base64!", base64.StdEncoding.EncodeToString([]byte("short"))} {
		if _, err := b.Open(bad); !errors.Is(err, ErrUnreadable) {
			t.Errorf("Open(%q) = %v, want ErrUnreadable", bad, err)
		}
	}
}

func TestWrongLabelOrSecret(t *testing.T) {
	t.Setenv("TIMELY_BACKUP_KEY", "backup-secret")
	sealed, _ := box(t, "timely-bot-source:").Seal("d4k3yabc1234")
	if _, err := box(t, "timely-agent-provider:").Open(sealed); !errors.Is(err, ErrUnreadable) {
		t.Fatalf("another label opened the value: %v", err)
	}
	t.Setenv("TIMELY_BACKUP_KEY", "another-secret")
	if _, err := box(t, "timely-bot-source:").Open(sealed); !errors.Is(err, ErrUnreadable) {
		t.Fatalf("another secret opened the value: %v", err)
	}
}

func TestSecretFromEnv(t *testing.T) {
	t.Setenv("TIMELY_BACKUP_KEY", "  ")
	t.Setenv("JWT_SECRET", "")
	if _, err := New("x:"); err == nil {
		t.Fatal("New with no secret succeeded")
	}
	// JWT_SECRET stands in when TIMELY_BACKUP_KEY is blank, and a
	// TIMELY_BACKUP_KEY with spaces around it is the same key without them.
	t.Setenv("JWT_SECRET", "jwt-secret")
	sealed, _ := box(t, "x:").Seal("v")
	t.Setenv("TIMELY_BACKUP_KEY", "jwt-secret ")
	if got, err := box(t, "x:").Open(sealed); err != nil || got != "v" {
		t.Fatalf("Open = %q, %v", got, err)
	}
}

func TestHint(t *testing.T) {
	for in, want := range map[string]string{"abcd1234": "…1234", "abcd": "…", "": "…"} {
		if got := Hint(in); got != want {
			t.Errorf("Hint(%q) = %q, want %q", in, got, want)
		}
	}
}
