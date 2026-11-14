package chat

import (
	"context"
	"strings"
	"testing"

	"timely-api/internal/features/agent"
)

// Phase 5, review round 2: security-lens findings on Go's host decision, each
// case failed before the fix.

func decideCall(t *testing.T, st hostState, tool string, args map[string]any) hostDecision {
	t.Helper()
	d, ok := decideHost(context.Background(), askOf(tool, args), st)
	if !ok {
		t.Fatalf("%s is not a host call", tool)
	}
	return d
}

// The hardline floor holds in every mode, Full Access included, however the
// program is spelled (Hermes' own floor misses an absolute path and a wrapper).
func TestHardlineFloorHoldsInEveryMode(t *testing.T) {
	for _, mode := range []agent.Mode{agent.Supervised, agent.Auto, agent.Full} {
		for _, c := range []string{"rm -rf /", "/bin/rm -rf /", "/usr/bin/rm -rf ~", "command rm -rf /", "nice rm -rf /", "cd / && rm -rf *", "mkfs.ext4 /dev/sda1", "bash -c '/bin/rm -rf $HOME'"} {
			d := decideCall(t, baseState(mode), "terminal", map[string]any{"command": c})
			if d.verdict != "block" || !strings.Contains(d.message, "never runs") {
				t.Errorf("%s: %q -> %s (%s)", mode, c, d.verdict, d.reason)
			}
		}
		// Review round 3: the home and the root written as ~/.., ${HOME:?}, a
		// variable, $(echo /), a move or an rsync --delete over them.
		for _, c := range []string{"rm -rf ~/../..", "rm -rf $HOME/..", "rm -rf \"${HOME:?}\"", "rm -rf $(echo /)", "H=~; rm -rf $H", "rm -rf ~me", "rm -rf /h?me",
			"rm -rf /home/me/{*,.*}", "find ~ -type f -exec rm -f {} +", "rsync -a --delete /tmp/empty/ ~/", "mv /home/me /tmp/gone", "rm -rf ../..",
			"python3 -c \"import shutil,os;shutil.rmtree(os.environ['HOME'])\"", "perl -MFile::Path -e 'rmtree($ENV{HOME})'"} {
			d := decideCall(t, baseState(mode), "terminal", map[string]any{"command": c})
			if d.verdict != "block" || !strings.Contains(d.message, "never runs") {
				t.Errorf("%s: %q -> %s (%s)", mode, c, d.verdict, d.reason)
			}
		}
		for _, code := range []string{"import os; os.system('rm -rf /')", "import subprocess; subprocess.run(['rm','-rf','/'])", "import shutil,os; shutil.rmtree(os.environ['HOME'])",
			"from pathlib import Path\nimport shutil\nshutil.rmtree(str(Path.home()))", "import shutil\nshutil.rmtree('/home/me')"} {
			d := decideCall(t, baseState(mode), "execute_code", map[string]any{"code": code})
			if d.verdict != "block" {
				t.Errorf("%s: execute_code %q -> %s", mode, code, d.verdict)
			}
		}
		// the call's own folder is the root
		d := decideCall(t, baseState(mode), "terminal", map[string]any{"command": "rm -rf *", "workdir": "/"})
		if d.verdict != "block" {
			t.Errorf("%s: rm -rf * in / -> %s", mode, d.verdict)
		}
		// an ordinary delete is not on the floor
		d = decideCall(t, baseState(mode), "terminal", map[string]any{"command": "rm -rf build"})
		if d.verdict == "block" {
			t.Errorf("%s: rm -rf build was blocked", mode)
		}
	}
}

// A V4A patch is judged and shown by every file it names, not only the first
// header or its `path` argument.
func TestPatchIsJudgedByEveryFileItNames(t *testing.T) {
	outside := "*** Begin Patch\n*** Delete File: /home/me/Documents/thesis.md\n*** End Patch"
	two := "*** Begin Patch\n*** Update File: /home/me/work/a.txt\n@@\n-x\n+y\n*** Delete File: /home/me/Documents/thesis.md\n*** End Patch"
	move := "*** Begin Patch\n*** Move File: /home/me/work/a.txt -> /home/me/Desktop/a.txt\n*** End Patch"
	insideTwo := "*** Begin Patch\n*** Update File: /home/me/work/a.txt\n@@\n-x\n+y\n*** Add File: /home/me/work/b.txt\n+z\n*** End Patch"
	for name, args := range map[string]map[string]any{
		"path inside, patch deletes outside": {"mode": "patch", "path": "/home/me/work/a.txt", "patch": outside},
		"two files, one deleted outside":     {"mode": "patch", "patch": two},
		"a move out of the folder":           {"mode": "patch", "patch": move},
	} {
		for _, mode := range []agent.Mode{agent.Auto, agent.Supervised} {
			d := decideCall(t, baseState(mode), "patch", args)
			if d.verdict != "approve" {
				t.Errorf("%s in %s: %s (%s)", name, mode, d.verdict, d.reason)
			}
			if mode == agent.Supervised && d.card.Grantable {
				t.Errorf("%s: a grantable card for a patch that deletes or moves", name)
			}
		}
	}
	// a delete inside the folder runs in Auto, but is never grantable
	if d := decideCall(t, baseState(agent.Supervised), "patch", map[string]any{"mode": "patch", "patch": "*** Begin Patch\n*** Delete File: /home/me/work/a.txt\n*** End Patch"}); d.verdict != "approve" || d.card.Grantable {
		t.Errorf("a delete inside the folder: %s grantable %v", d.verdict, d.card.Grantable)
	}
	// the card names every file
	d := decideCall(t, baseState(agent.Supervised), "patch", map[string]any{"mode": "patch", "path": "/home/me/work/a.txt", "patch": two})
	if !strings.Contains(d.card.Path, "/home/me/work/a.txt") || !strings.Contains(d.card.Path, "Delete /home/me/Documents/thesis.md") || d.card.Grantable {
		t.Errorf("card %+v", d.card)
	}
	// a grant for the folder does not let the outside delete through
	st := baseState(agent.Supervised)
	st.grants = HostGrants{*folderGrant("patch", "Change", "/home/me/work/x", "/home/me/work")}
	if d := decideCall(t, st, "patch", map[string]any{"mode": "patch", "path": "/home/me/work/a.txt", "patch": outside}); d.verdict != "approve" {
		t.Errorf("a folder grant covered an outside delete: %s %s", d.verdict, d.reason)
	}
	// every file inside one folder: Auto lets it through and a grant stays possible
	if d := decideCall(t, baseState(agent.Auto), "patch", map[string]any{"mode": "patch", "patch": insideTwo}); d.verdict != "allow" {
		t.Errorf("a patch inside the folder: %s (%s)", d.verdict, d.reason)
	}
	if d := decideCall(t, baseState(agent.Supervised), "patch", map[string]any{"mode": "patch", "patch": insideTwo}); d.verdict != "approve" || !d.card.Grantable {
		t.Errorf("a patch inside one folder: %s grantable %v", d.verdict, d.card.Grantable)
	}
	// replace mode is a plain path
	if d := decideCall(t, baseState(agent.Auto), "patch", map[string]any{"mode": "replace", "path": "notes.md", "old_string": "a", "new_string": "b"}); d.verdict != "allow" {
		t.Errorf("replace inside the folder: %s (%s)", d.verdict, d.reason)
	}
	// a patch that names no file at all is never run unasked
	if d := decideCall(t, baseState(agent.Auto), "patch", map[string]any{"mode": "patch", "patch": "nothing to see"}); d.verdict != "approve" {
		t.Errorf("an unreadable patch: %s", d.verdict)
	}
}

// Relative paths follow the folder the call really runs in: its own workdir,
// the session folder the worker reports, a cd on the line.
func TestRelativePathsFollowTheRealFolder(t *testing.T) {
	for name, c := range map[string]struct {
		tool string
		args map[string]any
		cwd  string
	}{
		"workdir outside":      {"terminal", map[string]any{"command": "rm -f *", "workdir": "/home/me"}, ""},
		"workdir elsewhere":    {"terminal", map[string]any{"command": "echo x > thesis.md", "workdir": "/home/me/Documents"}, ""},
		"a cd on the line":     {"terminal", map[string]any{"command": "cd ~/Documents && rm -f thesis.md"}, ""},
		"the session's folder": {"terminal", map[string]any{"command": "rm thesis.md"}, "/home/me/Documents"},
		"write_file there":     {"write_file", map[string]any{"path": "thesis.md", "content": "x"}, "/home/me/Documents"},
	} {
		ask := askOf(c.tool, c.args)
		ask.Cwd = c.cwd
		d, _ := decideHost(context.Background(), ask, baseState(agent.Auto))
		if d.verdict != "approve" || d.card.CriticalItem != agent.CriticalDeleting {
			t.Errorf("%s: %s item %d (%s)", name, d.verdict, d.card.CriticalItem, d.reason)
		}
	}
	// the same commands inside the folder are fine
	for _, c := range []map[string]any{{"command": "rm scratch.txt"}, {"command": "rm scratch.txt", "workdir": "/home/me/work/sub"}, {"command": "cd sub && rm scratch.txt"}} {
		if d := decideCall(t, baseState(agent.Auto), "terminal", c); d.verdict != "allow" {
			t.Errorf("%v: %s (%s)", c, d.verdict, d.reason)
		}
	}
	// a grant for `rm` taken in one folder does not cover another folder (the
	// command is critical there, and no grant covers a critical item)
	st := baseState(agent.Supervised)
	st.grants = HostGrants{*commandGrant("rm draft.txt")}
	if d := decideCall(t, st, "terminal", map[string]any{"command": "rm thesis.md", "workdir": "/home/me/Documents"}); d.verdict != "approve" {
		t.Errorf("a grant covered a delete outside the folder: %s %s", d.verdict, d.reason)
	}
}

// A script file, git -C, unlink, sed -i and gh api ask in Auto and never ride
// a grant.
func TestAutoAsksForScriptsAndTheOtherGaps(t *testing.T) {
	for _, c := range []string{
		"bash cleanup.sh", "./cleanup.sh", "python3 tidy.py", "source cleanup.sh", "sh /home/me/work/cleanup.sh",
		"git -C . push --force origin main", "unlink /home/me/notes.txt", "sed -i d /home/me/.bashrc", "gh api repos/o/r/issues -f title=x",
	} {
		d := decideCall(t, baseState(agent.Auto), "terminal", map[string]any{"command": c})
		if d.verdict != "approve" || d.card.CriticalItem == 0 {
			t.Errorf("%q in Auto: %s (%s)", c, d.verdict, d.reason)
		}
	}
	// git -C ... status keeps the grant key of git status, and a force-push there is a card
	if g := commandGrant("git -C /home/me/proj status"); g == nil || g.Match != "terminal:git status" {
		t.Errorf("git -C grant %+v", g)
	}
	st := baseState(agent.Supervised)
	st.grants = HostGrants{*commandGrant("git -C /home/me/proj status")}
	for _, c := range []string{"git -C /home/me/proj push --force origin main", "git -C /home/me/proj reset --hard", "git -C /home/me/proj clean -fdx"} {
		if d := decideCall(t, st, "terminal", map[string]any{"command": c}); d.verdict != "approve" {
			t.Errorf("a git status grant covered %q: %s", c, d.verdict)
		}
	}
	if d := decideCall(t, st, "terminal", map[string]any{"command": "git -C /home/me/proj status"}); d.verdict != "allow" {
		t.Errorf("the granted command itself: %s (%s)", d.verdict, d.reason)
	}
}

// Q-5.1: "Allow for this chat" on a terminal command has to fire for the next
// one even though the granted command's own output taints the chat. Pages, a
// browser and MCP results still keep every call a card.
func TestTerminalGrantFiresAfterLocalOutputTaint(t *testing.T) {
	ask := askOf("terminal", map[string]any{"command": "git status --short"})
	for _, mode := range []agent.Mode{agent.Supervised, agent.Auto} {
		st := baseState(mode)
		st.grants = HostGrants{*commandGrant("git status")}
		st.tainted, st.taintedLocal = true, true
		d, _ := decideHost(context.Background(), ask, st)
		if d.verdict != "allow" || d.by != "grant" {
			t.Errorf("%s: a granted git status after local output: %s (%s)", mode, d.verdict, d.reason)
		}
		// without a grant it still asks, and the card offers one
		st.grants = nil
		d, _ = decideHost(context.Background(), ask, st)
		if d.verdict != "approve" || !d.card.Grantable {
			t.Errorf("%s: no grant yet: %s grantable %v", mode, d.verdict, d.card.Grantable)
		}
		// outside content in the taint: a card, and no grant
		st.grants = HostGrants{*commandGrant("git status")}
		st.taintedLocal = false
		d, _ = decideHost(context.Background(), ask, st)
		if d.verdict != "approve" || d.card.CriticalItem != agent.CriticalTainted || d.card.Grantable {
			t.Errorf("%s: after a page: %s item %d grantable %v", mode, d.verdict, d.card.CriticalItem, d.card.Grantable)
		}
	}
	// a delete after local output is its own critical item, and no grant covers it
	st := baseState(agent.Supervised)
	st.grants = HostGrants{*commandGrant("rm x")}
	st.tainted, st.taintedLocal = true, true
	d, _ := decideHost(context.Background(), askOf("terminal", map[string]any{"command": "rm -rf build"}), st)
	if d.verdict != "approve" || d.card.CriticalItem != agent.CriticalDeleting || d.card.Grantable {
		t.Errorf("rm -rf after local output with a grant: %s item %d grantable %v", d.verdict, d.card.CriticalItem, d.card.Grantable)
	}
	// Supervised is never looser than Auto for the same call, grants and taint
	for _, taintLocal := range []bool{false, true} {
		for _, withGrant := range []bool{false, true} {
			build := func(mode agent.Mode) hostDecision {
				st := baseState(mode)
				st.tainted, st.taintedLocal = true, taintLocal
				if withGrant {
					st.grants = HostGrants{*commandGrant("git status")}
				}
				d, _ := decideHost(context.Background(), ask, st)
				return d
			}
			rank := map[string]int{"block": 2, "approve": 1, "allow": 0}
			if sup, auto := build(agent.Supervised), build(agent.Auto); rank[sup.verdict] < rank[auto.verdict] {
				t.Errorf("local %v grant %v: supervised %s is looser than auto %s", taintLocal, withGrant, sup.verdict, auto.verdict)
			}
		}
	}
}

func TestOutsideTaint(t *testing.T) {
	if outsideTaint(nil) || outsideTaint([]TaintSource{{Kind: "file"}, {Kind: "terminal"}, {Kind: "code"}}) {
		t.Error("local sources are not outside")
	}
	for _, kind := range []string{"web", "browser", "mcp", "vision", "bot", "past_chat", ""} {
		if !outsideTaint([]TaintSource{{Kind: "file"}, {Kind: kind}}) {
			t.Errorf("%q is outside", kind)
		}
	}
}

// A second card still queued in memory when the run parks is not dropped
// silently: the thread says it did not run.
func TestQueuedCardsAreNotSilentlyDroppedWhenTheRunParks(t *testing.T) {
	var queued workerEvent
	queued.Payload.RequestID, queued.Payload.ToolCallID, queued.Payload.Tool = "req-2", "call_2", "terminal"
	r := &agentRun{hostQueue: []workerEvent{queued}, cards: map[string]hostPending{"call_2": {tool: "terminal", card: HostCard{Kind: cardTerminal, Title: "Run this command?", Command: "pwd"}}}}
	row := &Conversation{}
	(&WorkerEngine{}).queuedNotRun(row, r, "")
	if len(row.Messages) != 1 || !strings.Contains(row.Messages[0].Content, "pwd") || len(r.hostQueue) != 0 {
		t.Fatalf("messages %+v queue %d", row.Messages, len(r.hostQueue))
	}
}

// The browser card shows what the call does as plain text, never the model's
// raw JSON: the script for browser_exec, the method and parameters for
// browser_cdp. A script that names no address opens nothing, so no address
// and no "opens a site" reason.
func TestBrowserCardShowsTheScriptNotTheJSON(t *testing.T) {
	script := "click(120, 300)\nprint(js(\"document.title\"))"
	for _, mode := range []agent.Mode{agent.Supervised, agent.Auto, agent.Full} {
		d := decideCall(t, baseState(mode), "browser_exec", map[string]any{"code": script})
		if d.verdict != "approve" || d.card.URL != "" || d.card.Command != script || strings.Contains(d.card.Command, `\"`) || strings.HasPrefix(d.card.Command, "{") {
			t.Errorf("%s: card %+v", mode, d.card)
		}
		if strings.Contains(d.card.Reason, "site") || d.card.CriticalItem != 0 {
			t.Errorf("%s: reason %q item %d: nothing is opened and no list item applies", mode, d.card.Reason, d.card.CriticalItem)
		}
		if mode != agent.Supervised && !strings.Contains(d.card.Reason, "signed-in browser") {
			t.Errorf("%s: reason %q", mode, d.card.Reason)
		}
	}
	// a goto names the address; the script is still shown once, as text
	d := decideCall(t, baseState(agent.Supervised), "browser_exec", map[string]any{"code": "goto(\"https://example.com/\")\nprint(title())"})
	if d.card.URL != "https://example.com/" || d.card.Command != "goto(\"https://example.com/\")\nprint(title())" {
		t.Errorf("goto card %+v", d.card)
	}
	// a new, unmentioned site is the usual critical item 2 in Auto
	if d := decideCall(t, baseState(agent.Auto), "browser_exec", map[string]any{"code": "goto(\"https://unknown.example.net/\")"}); d.card.CriticalItem != agent.CriticalSendingOut || !strings.Contains(d.card.Reason, "site") {
		t.Errorf("an unmentioned site: %+v", d.card)
	}
	// browser_cdp: the method and its parameters, a url parameter as the address
	d = decideCall(t, baseState(agent.Supervised), "browser_cdp", map[string]any{"method": "Page.navigate", "params": map[string]any{"url": "https://example.org/x"}})
	if d.card.URL != "https://example.org/x" || !strings.HasPrefix(d.card.Command, "Page.navigate ") || strings.Contains(d.card.Command, "method") {
		t.Errorf("cdp card %+v", d.card)
	}
	d = decideCall(t, baseState(agent.Supervised), "browser_cdp", map[string]any{"method": "Target.getTargets"})
	if d.card.URL != "" || d.card.Command != "Target.getTargets" {
		t.Errorf("cdp card without params %+v", d.card)
	}
	d = decideCall(t, baseState(agent.Supervised), "browser_dialog", map[string]any{"action": "accept", "prompt_text": "yes"})
	if d.card.Command != "accept yes" || d.card.URL != "" {
		t.Errorf("dialog card %+v", d.card)
	}
	// a payment page in the script is still item 3
	if d := decideCall(t, baseState(agent.Auto), "browser_exec", map[string]any{"code": "goto(\"https://shop.example.org/checkout\")"}); d.card.CriticalItem != agent.CriticalPaying {
		t.Errorf("checkout script: %+v", d.card)
	}
}

// A patch whose `path` and header name the same file shows it once.
func TestPatchCardNamesAFileOnce(t *testing.T) {
	patch := "*** Begin Patch\n*** Update File: /home/me/work/a.txt\n@@\n-x\n+y\n*** End Patch"
	d := decideCall(t, baseState(agent.Supervised), "patch", map[string]any{"mode": "patch", "path": "/home/me/work/a.txt", "patch": patch})
	if d.card.Path != "/home/me/work/a.txt" || d.card.Title != "Change this file?" || !d.card.Grantable {
		t.Errorf("card %+v", d.card)
	}
}

// Review round 3: a grant from a harmless use of a multi-purpose program must
// not cover its destructive form, and the destructive forms are never
// grantable (item 1).
func TestGrantKeysNameTheOperationOfMultiPurposePrograms(t *testing.T) {
	for _, pair := range [][2]string{
		{"terraform plan", "terraform destroy -auto-approve"}, {"aws s3 ls", "aws s3 rm s3://bucket --recursive"}, {"aws ec2 describe-instances", "aws ec2 terminate-instances"},
		{"gcloud compute instances list", "gcloud compute instances delete vm"}, {"helm list", "helm uninstall x"}, {"heroku apps", "heroku apps:destroy x"},
		{"rclone ls remote:", "rclone purge remote:b"}, {"docker ps", "docker rm -f db"}, {"kubectl get pods", "kubectl delete ns prod"},
	} {
		a, b := commandGrant(pair[0]), commandGrant(pair[1])
		if a == nil || b == nil || a.Match == b.Match {
			t.Errorf("%q and %q share a grant: %+v %+v", pair[0], pair[1], a, b)
		}
	}
	for _, mode := range []agent.Mode{agent.Supervised, agent.Auto} {
		st := baseState(mode)
		st.grants = HostGrants{*commandGrant("terraform plan"), *commandGrant("aws s3 ls"), *commandGrant("git stash list"), *commandGrant("docker ps")}
		for _, c := range []string{"terraform destroy -auto-approve", "aws s3 rm s3://bucket --recursive", "git stash clear", "docker volume prune -f", "docker rm -f db", "kubectl delete ns prod"} {
			d := decideCall(t, st, "terminal", map[string]any{"command": c})
			if d.verdict != "approve" || d.by == "grant" || d.card.CriticalItem != agent.CriticalDeleting || d.card.Grantable {
				t.Errorf("%s: %q -> %s by %q item %d grantable %v", mode, c, d.verdict, d.by, d.card.CriticalItem, d.card.Grantable)
			}
		}
	}
}
