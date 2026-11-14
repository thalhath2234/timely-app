package chat

import (
	"strings"
	"testing"

	"timely-api/internal/features/agent"
)

// Phase 5, review round 5: the folder Go judges is the folder Hermes runs the
// call in. Only the terminal reads `workdir` (and expands ~); no tool reads
// `cwd`. Each case failed before the fix.

func TestHostCallJudgesTheFolderHermesRunsItIn(t *testing.T) {
	// Full Access: a key Hermes ignores, or a ~ it expands, must not hide the floor.
	for name, args := range map[string]map[string]any{
		"cwd key is ignored":        {"command": "rm -rf ..", "cwd": "/home/me/work/a"},
		"deep cwd key is ignored":   {"command": "rm -rf ../..", "cwd": "/home/me/work/a/b/c"},
		"workdir ~ is the home":     {"command": "rm -rf *", "workdir": "~"},
		"workdir ~ and find":        {"command": "find . -delete", "workdir": "~"},
		"workdir ~/ is in the home": {"command": "rm -rf *", "workdir": "~/"},
	} {
		d := decideCall(t, baseState(agent.Full), "terminal", args)
		if d.verdict != "block" || !strings.Contains(d.message, "never runs") {
			t.Errorf("full access, %s: %s (%s) by %s", name, d.verdict, d.reason, d.by)
		}
	}
	// Auto: critical item 1 (a write outside the folder) still asks.
	for name, c := range map[string]struct {
		tool string
		args map[string]any
	}{
		"write_file with a cwd key":     {"write_file", map[string]any{"path": "../Documents/notes.txt", "content": "x", "cwd": "/home/me/work/sub"}},
		"write_file with a workdir key": {"write_file", map[string]any{"path": "../Documents/notes.txt", "content": "x", "workdir": "/home/me/work/sub"}},
		"patch with a cwd key":          {"patch", map[string]any{"path": "../Documents/a.txt", "cwd": "/home/me/work/sub"}},
		"terminal with a cwd key":       {"terminal", map[string]any{"command": "echo > ../Documents/thesis.docx", "cwd": "/home/me/work/sub"}},
		"terminal workdir ~/Documents":  {"terminal", map[string]any{"command": "echo > notes.txt", "workdir": "~/Documents"}},
	} {
		if d := decideCall(t, baseState(agent.Auto), c.tool, c.args); d.verdict != "approve" {
			t.Errorf("auto, %s: %s by %s", name, d.verdict, d.by)
		}
	}
}

// The card, and a grant keyed on it, show the folder the call runs in.
func TestHostCallCardShowsTheRealFolder(t *testing.T) {
	cases := []struct {
		name, tool, session string
		args                map[string]any
		want                string
	}{
		{"cwd key ignored", "terminal", "", map[string]any{"command": "ls", "cwd": "/home/me/work/sub"}, "/home/me/work"},
		{"file tool ignores workdir", "read_file", "", map[string]any{"path": "a.txt", "workdir": "/etc"}, "/home/me/work"},
		{"tilde is the home", "terminal", "", map[string]any{"command": "ls", "workdir": "~"}, "/home/me"},
		{"tilde path", "terminal", "", map[string]any{"command": "ls", "workdir": "~/Documents"}, "/home/me/Documents"},
		{"relative from the session folder", "terminal", "/home/me/work/sub", map[string]any{"command": "ls", "workdir": "x"}, "/home/me/work/sub/x"},
		{"relative with no session folder", "terminal", "", map[string]any{"command": "ls", "workdir": "x"}, "/home/me/work/x"},
		{"file tool uses the session folder", "read_file", "/home/me/work/sub", map[string]any{"path": "a.txt"}, "/home/me/work/sub"},
	}
	for _, c := range cases {
		_, card, _ := hostCall(c.tool, c.args, "/home/me/work", c.session, "/home/me")
		if card.Cwd != c.want {
			t.Errorf("%s: card folder %q, want %q", c.name, card.Cwd, c.want)
		}
	}
}
