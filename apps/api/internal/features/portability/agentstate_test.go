package portability

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"timely-api/internal/agenthost"
)

// fakeAgent is the AgentStore a test sees: it hands out a fixed zip and
// records every stage, commit and discard.
type fakeAgent struct {
	mu        sync.Mutex
	zip       []byte
	exportErr error
	stageErr  error
	commitErr error
	restored  []string
	blocked   []string
	staged    [][]byte
	committed []agenthost.Staged
	discarded []agenthost.Staged
}

func (f *fakeAgent) ExportState(_ context.Context, _ string) ([]byte, string, error) {
	if f.exportErr != nil {
		return nil, "", f.exportErr
	}
	return f.zip, checksum(f.zip), nil
}

func (f *fakeAgent) StageRestore(_ context.Context, account string, zip []byte) (agenthost.Staged, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.staged = append(f.staged, append([]byte(nil), zip...))
	if f.stageErr != nil {
		return agenthost.Staged{}, f.stageErr
	}
	return agenthost.Staged{Account: account, Dir: fmt.Sprintf("staged-%d", len(f.staged)), RestoredSkills: f.restored, Blocked: f.blocked}, nil
}

func (f *fakeAgent) CommitRestore(_ context.Context, staged agenthost.Staged) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.committed = append(f.committed, staged)
	return f.commitErr
}

func (f *fakeAgent) DiscardRestore(staged agenthost.Staged) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.discarded = append(f.discarded, staged)
	return nil
}

func (f *fakeAgent) counts() (staged, committed, discarded int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.staged), len(f.committed), len(f.discarded)
}

func agentState(zip string) *AgentState {
	return &AgentState{Format: agenthost.AgentStateFormat, Version: agenthost.AgentStateVersion, SHA256: checksum([]byte(zip)), Zip: []byte(zip)}
}

// Restore decodes with DisallowUnknownFields (handler.go), so a schema 3
// backup with its agent state and warnings must decode, and the zip travels
// as base64.
func TestSchema3BackupDecodesStrictly(t *testing.T) {
	in := Backup{Format: backupFormat, SchemaVersion: schemaVersion, Rows: basicRows(nil),
		Agent: agentState("zip bytes"), Warnings: []string{"left out"}}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"zip":"emlwIGJ5dGVz"`)) {
		t.Fatalf("zip is not base64 in %s", raw)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var out Backup
	if err := decoder.Decode(&out); err != nil {
		t.Fatal(err)
	}
	if string(out.Agent.Zip) != "zip bytes" || out.Agent.SHA256 != in.Agent.SHA256 || len(out.Warnings) != 1 {
		t.Fatalf("decoded %+v", out)
	}
	if schemaVersion != 3 {
		t.Fatalf("schemaVersion = %d", schemaVersion)
	}
}

func TestValidateAgentState(t *testing.T) {
	if err := validateAgentState(agentState("zip")); err != nil {
		t.Fatalf("good state refused: %v", err)
	}
	damaged := agentState("zip")
	damaged.Zip = []byte("zap")
	wrongFormat := agentState("zip")
	wrongFormat.Format = "other"
	wrongVersion := agentState("zip")
	wrongVersion.Version = 2
	empty := agentState("")
	for name, state := range map[string]*AgentState{"damaged": damaged, "format": wrongFormat, "version": wrongVersion, "empty": empty} {
		if err := validateAgentState(state); err == nil || !strings.Contains(err.Error(), "not changed") {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// The export leaves the agent state out, with words that say why, when it
// is too large or cannot be read; an account that never used the agent, or
// a server with no agent store, has none and no warning.
func TestExportAgentWarnings(t *testing.T) {
	cases := []struct {
		name  string
		store AgentStore
		want  []string
		agent bool
	}{
		{"no store", nil, nil, false},
		{"good", &fakeAgent{zip: []byte("zip")}, nil, true},
		{"never used", &fakeAgent{exportErr: agenthost.ErrNoAgentState}, nil, false},
		{"over the cap", &fakeAgent{exportErr: fmt.Errorf("%w (70 MB, the limit is 64 MB)", agenthost.ErrStateTooLarge)}, []string{warnAgentTooLarge}, false},
		{"no runtime", &fakeAgent{exportErr: &agenthost.StartError{Err: agenthost.ErrNoRuntime}}, []string{warnAgentUnavailable}, false},
		{"helper failed", &fakeAgent{exportErr: errors.New("agent runtime step failed: database busy")}, []string{warnAgentUnreadable}, false},
	}
	for _, c := range cases {
		s := &Service{}
		if c.store != nil {
			s.SetAgentState(c.store)
		}
		agent, warnings := s.exportAgent(context.Background(), "usr_1")
		if (agent != nil) != c.agent || fmt.Sprint(warnings) != fmt.Sprint(c.want) {
			t.Errorf("%s: agent %v, warnings %q", c.name, agent != nil, warnings)
		}
		if agent != nil && (agent.SHA256 != checksum([]byte("zip")) || agent.Format != agenthost.AgentStateFormat) {
			t.Errorf("%s: agent %+v", c.name, agent)
		}
	}
	if !strings.Contains(warnAgentTooLarge, "64 MB") {
		t.Fatalf("cap warning %q", warnAgentTooLarge)
	}
}

// What an outside app downloads keeps nothing of what Timely learned.
func TestOutsideBackupStripsWhatTimelyLearned(t *testing.T) {
	backup := map[string]any{"agent": map[string]any{"zip": "x"}, "rows": map[string]any{
		"agent_learning_events":   []any{map[string]any{"after": "Has a cardiology appointment"}},
		"agent_learning_settings": []any{}, "workspaces": []any{map[string]any{"id": "w"}},
	}}
	OutsideBackup(backup)
	rows := backup["rows"].(map[string]any)
	if _, ok := backup["agent"]; ok || rows["agent_learning_events"] != nil || rows["agent_learning_settings"] != nil || rows["workspaces"] == nil {
		t.Fatalf("outside backup %v", backup)
	}
}
