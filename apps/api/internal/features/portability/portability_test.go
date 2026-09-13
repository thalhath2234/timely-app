package portability

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateBackupRejectsUnknownAndOversizedSchemas(t *testing.T) {
	valid := &Backup{
		Format: backupFormat, SchemaVersion: schemaVersion,
		Rows: map[string][]json.RawMessage{"tasks": {json.RawMessage(`{"id":"tsk_1"}`)}},
	}
	if err := validateBackup(valid); err != nil {
		t.Fatalf("valid backup rejected: %v", err)
	}

	unknown := *valid
	unknown.Rows = map[string][]json.RawMessage{"users": {json.RawMessage(`{"id":"usr_1"}`)}}
	if err := validateBackup(&unknown); err == nil || !strings.Contains(err.Error(), "unknown table") {
		t.Fatalf("expected unknown table error, got %v", err)
	}

	wrongVersion := *valid
	wrongVersion.SchemaVersion++
	if err := validateBackup(&wrongVersion); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected schema error, got %v", err)
	}
}

func TestEncryptedBackupRoundTripAndTamperDetection(t *testing.T) {
	service := &Service{}
	service.key = [32]byte{1, 2, 3, 4, 5}
	plain := []byte(`{"format":"timely-backup"}`)
	sealed, err := service.encrypt(plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, plain) {
		t.Fatal("encrypted backup contains plaintext")
	}
	restored, err := service.decrypt(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, plain) {
		t.Fatalf("round trip = %q", restored)
	}
	sealed[len(sealed)-1] ^= 1
	if _, err := service.decrypt(sealed); err == nil {
		t.Fatal("tampered backup was accepted")
	}
}

func TestTextPDFIsValidAndPaged(t *testing.T) {
	body := strings.Repeat("A readable line of exported content.\n", 120)
	pdf := textPDF("Long document", body)
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatal("missing PDF header")
	}
	if !bytes.HasSuffix(pdf, []byte("%%EOF\n")) {
		t.Fatal("missing PDF trailer")
	}
	if bytes.Count(pdf, []byte("/Type /Page ")) < 3 {
		t.Fatal("long document was not paged")
	}
}

func TestICSEscape(t *testing.T) {
	if got := icsEscape("one,two;three\nfour"); got != `one\,two\;three\nfour` {
		t.Fatalf("icsEscape = %q", got)
	}
}
