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

// Review round 6: the agent cannot give its own chat Full Access through the
// database. A database client asks in Auto and Supervised and is never
// grantable, so an earlier "Allow for this chat" on a harmless query covers
// nothing; reading the files that hold the database password asks too.
func TestHostCallDatabaseAndSecretsAsk(t *testing.T) {
	update := `PGPASSWORD=root123 psql -h localhost -U timely -d timely -c "update conversations set permission='full'"`
	for _, mode := range []agent.Mode{agent.Auto, agent.Supervised} {
		for name, c := range map[string]struct {
			tool string
			args map[string]any
		}{
			"psql update":         {"terminal", map[string]any{"command": update}},
			"cat .env":            {"terminal", map[string]any{"command": "cat /home/me/Dev/timely-app/.env"}},
			"read_file .env":      {"read_file", map[string]any{"path": "/home/me/Dev/timely-app/.env"}},
			"read desktop config": {"read_file", map[string]any{"path": "/home/me/.config/Timely/config.json"}},
			"truncate":            {"terminal", map[string]any{"command": `psql -c "TRUNCATE tasks"`}},
		} {
			d := decideCall(t, baseState(mode), c.tool, c.args)
			if d.verdict != "approve" || d.card.Grantable {
				t.Errorf("%v, %s: %s by %s, grantable %v", mode, name, d.verdict, d.by, d.card.Grantable)
			}
		}
	}
	st := baseState(agent.Supervised)
	st.grants = HostGrants{*commandGrant(`psql -d timely -c "select count(*) from tasks"`)}
	if d := decideCall(t, st, "terminal", map[string]any{"command": update}); d.verdict != "approve" {
		t.Errorf("a grant made from a SELECT covered the UPDATE: %s by %s", d.verdict, d.by)
	}
}

// Review round 6: a card for typing into a running command names the running
// command, labels the text as typed input and carries no folder; the manage
// form is said in words, not in Hermes' own syntax.
func TestHostCallProcessCardsNameTheRunningCommand(t *testing.T) {
	d := decideCall(t, baseState(agent.Supervised), "process_manage", map[string]any{"action": "submit", "session_id": "proc_abc123", "data": "y"})
	if d.verdict != "approve" || !d.card.Stdin || d.card.Session != "proc_abc123" || d.card.Command != "y" || d.card.Cwd != "" || d.card.Grantable {
		t.Errorf("stdin card %+v (%s)", d.card, d.verdict)
	}
	d = decideCall(t, baseState(agent.Supervised), "process_manage", map[string]any{"action": "kill", "session_id": "proc_abc123"})
	if d.card.Title != "Stop a running command?" || d.card.Command != "Stop the running command proc_abc123" || d.card.Stdin || d.card.Session != "proc_abc123" {
		t.Errorf("kill card %+v", d.card)
	}
	d = decideCall(t, baseState(agent.Supervised), "process", map[string]any{"action": "poll", "session_id": "proc_abc123"})
	if d.card.Title != "Check on a running command?" || strings.Contains(d.card.Command, "process poll") {
		t.Errorf("poll card %+v", d.card)
	}
}
