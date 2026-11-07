package provider

import (
	"testing"

	"timely-api/internal/secretbox"
)

// A provider key sealed by this package opens with secretbox under the
// provider's label, so the two share one at-rest scheme and the provider can
// move onto secretbox without re-sealing anything.
func TestProviderSealOpensWithSecretbox(t *testing.T) {
	for _, env := range []struct{ backup, jwt string }{{"backup-secret", ""}, {"", "jwt-secret"}} {
		t.Setenv("TIMELY_BACKUP_KEY", env.backup)
		t.Setenv("JWT_SECRET", env.jwt)
		sealed, err := New(nil, nil, nil).encrypt("sk-or-v1-abcd1234")
		if err != nil {
			t.Fatal(err)
		}
		box, err := secretbox.New("timely-agent-provider:")
		if err != nil {
			t.Fatal(err)
		}
		if got, err := box.Open(sealed); err != nil || got != "sk-or-v1-abcd1234" {
			t.Fatalf("secretbox opened %q, %v", got, err)
		}
		again, err := box.Seal("sk-or-v1-abcd1234")
		if err != nil {
			t.Fatal(err)
		}
		if got, err := New(nil, nil, nil).decrypt(again); err != nil || got != "sk-or-v1-abcd1234" {
			t.Fatalf("provider opened %q, %v", got, err)
		}
		if hint("sk-or-v1-abcd1234") != secretbox.Hint("sk-or-v1-abcd1234") {
			t.Fatal("hints differ")
		}
	}
}
