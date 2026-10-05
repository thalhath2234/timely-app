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

	legacy := *valid
	legacy.SchemaVersion = 1
	if err := validateBackup(&legacy); err != nil {
		t.Fatalf("version 1 without nested tasks rejected: %v", err)
	}

	nested := legacy
	nested.Rows = map[string][]json.RawMessage{
		"tasks": {json.RawMessage(`{"id":"tsk_child","parent_task_id":"tsk_parent"}`)},
	}
	if err := validateBackup(&nested); err == nil || !strings.Contains(err.Error(), "nested tasks") {
		t.Fatalf("expected nested-task backup error, got %v", err)
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

func TestCheckRestoreParentsRejectsForeignParents(t *testing.T) {
	mine := map[string]bool{"workspaces/ws_mine": true, "projects/pr_mine": true, "custom_fields/cf_mine": true}
	owned := func(table, id string) bool { return mine[table+"/"+id] }

	if err := checkRestoreParents("projects", map[string]any{"id": "pr_x", "workspace_id": "ws_theirs"}, owned); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("project in foreign workspace: expected not found, got %v", err)
	}
	if err := checkRestoreParents("stages", map[string]any{"id": "sg_x", "project_id": nil}, owned); err == nil {
		t.Fatal("stage without project should be rejected")
	}
	if err := checkRestoreParents("custom_field_values", map[string]any{"id": "cfv_x", "custom_field_id": "cf_theirs"}, owned); err == nil {
		t.Fatal("value of foreign field should be rejected")
	}
	if err := checkRestoreParents("stages", map[string]any{"id": "sg_x", "project_id": "pr_mine"}, owned); err != nil {
		t.Fatalf("owned project should pass: %v", err)
	}

	// Optional links to foreign rows are dropped, not kept.
	value := map[string]any{"id": "cfv_y", "custom_field_id": "cf_mine", "task_id": "tsk_theirs", "project_id": "pr_mine"}
	if err := checkRestoreParents("custom_field_values", value, owned); err != nil {
		t.Fatalf("owned field should pass: %v", err)
	}
	if value["task_id"] != nil || value["project_id"] != "pr_mine" {
		t.Fatalf("foreign task link should be cleared, got %v", value)
	}
	task := map[string]any{"id": "tsk_1", "user_id": "usr_1", "workspace_id": "ws_mine", "status_id": "st_theirs"}
	if err := checkRestoreParents("tasks", task, owned); err != nil || task["status_id"] != nil || task["workspace_id"] != "ws_mine" {
		t.Fatalf("foreign status should be cleared: %v %v", err, task)
	}
}
