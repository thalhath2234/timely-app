package agent

import "testing"

// Phase 5, review round 2: critical-list gaps, each case failed before the
// fix.

// A script file is code nobody can read on a card, and the agent may have
// written it a moment ago: running one is critical in Auto.
func TestCriticalHostScriptFiles(t *testing.T) {
	for _, c := range []string{
		"bash cleanup.sh", "sh " + ws + "/cleanup.sh", "./cleanup.sh", "../cleanup.sh", "source cleanup.sh", ". ./cleanup.sh",
		"python3 tidy.py", "python script.py > out.txt", "node index.js", "ruby run.rb", "perl run.pl", "bash -x run.sh",
		ws + "/tidy.sh", "/usr/bin/env bash run.sh", "nohup ./go.sh", "timeout 5 python3 build.py",
	} {
		item, reason, ok := CriticalHost(command(c), scope)
		wantCritical(t, CriticalDeleting, c, item, reason, ok)
	}
	for _, c := range []string{"python3 -m pytest", "python3 -m pip --version", "ls ./notes", "cat tidy.sh", "bash --version", "which bash", "git status"} {
		item, reason, ok := CriticalHost(command(c), scope)
		wantFine(t, c, item, reason, ok)
	}
}

// Relative paths are judged from the folder the call runs in, not from the
// agent's folder: the call's own workdir, a cd earlier on the line, and a cd
// it cannot follow.
func TestCriticalHostRelativePathsFollowTheRealFolder(t *testing.T) {
	sc := HostScope{Workspace: "/home/me/work", Home: "/home/me", Hosts: scope.Hosts}
	crit := func(label string, h HostAction) {
		t.Helper()
		item, reason, ok := CriticalHost(h, sc)
		wantCritical(t, CriticalDeleting, label, item, reason, ok)
	}
	fine := func(label string, h HostAction) {
		t.Helper()
		item, reason, ok := CriticalHost(h, sc)
		wantFine(t, label, item, reason, ok)
	}
	for _, c := range []struct{ line, cwd string }{
		{"rm -f *", "/home/me"},
		{"rm -f thesis.md", "/home/me/Documents"},
		{"echo x > thesis.md", "/home/me/Documents"},
		{"mv a.txt thesis.md", "/home/me/Documents"},
		{"cd ~/Documents && rm -f thesis.md", ""},
		{"cd /home/me/Documents && rm -f *", ""},
		{"cd ~ ; rm notes.txt", ""},
		{"cd .. && rm notes.txt", ""},
		{"cd $HOME/Documents && rm thesis.md", ""},
		{"cd $SOMEWHERE && rm thesis.md", ""},
		{"popd && rm thesis.md", ""},
		{"cd - && rm thesis.md", ""},
		{"(cd ~/Documents; rm thesis.md)", ""},
		{"cd && rm thesis.md", ""},
		{"rm thesis.md", "../Documents"},
		{"cd /tmp && echo x > a.txt", ""},
	} {
		crit(c.line+" in "+c.cwd, HostAction{Kind: HostTerminal, Command: c.line, Cwd: c.cwd})
	}
	for _, c := range []struct{ line, cwd string }{
		{"rm scratch.txt", "/home/me/work"},
		{"rm scratch.txt", ""},
		{"cd drafts && rm scratch.txt", ""},
		{"cd /home/me/work/drafts && rm *.tmp", ""},
		{"cd ../work && rm x.txt", "/home/me/work/drafts"},
		{"echo x > out.txt", "sub"},
		{"cd ~/Documents && ls", ""},
	} {
		fine(c.line+" in "+c.cwd, HostAction{Kind: HostTerminal, Command: c.line, Cwd: c.cwd})
	}
	crit("write_file relative in another folder", HostAction{Kind: HostFileWrite, Path: "thesis.md", Cwd: "/home/me/Documents"})
	fine("write_file relative in the folder", HostAction{Kind: HostFileWrite, Path: "a.md", Cwd: "/home/me/work/drafts"})
	// A working folder that is the home, a parent of it or the disk's root is
	// no safe folder.
	for _, ws := range []string{"/", "/home", "/home/me", "/home/me/"} {
		bad := HostScope{Workspace: ws, Home: "/home/me"}
		item, reason, ok := CriticalHost(command("rm /home/me/x.txt"), bad)
		wantCritical(t, CriticalDeleting, "working folder "+ws, item, reason, ok)
	}
}

// The critical list sees through git's global options, unlink, sed -i and
// gh api.
func TestCriticalHostMoreGaps(t *testing.T) {
	for c, want := range map[string]int{
		"git -C . push --force origin main":         CriticalDeleting,
		"git -C /home/me/repo reset --hard":         CriticalDeleting,
		"git -C /r clean -fdx":                      CriticalDeleting,
		"git -C /home/me/repo push origin main":     CriticalSendingOut,
		"git --git-dir=/x/.git push origin main":    CriticalSendingOut,
		"git -c alias.x=!rm status":                 CriticalSettings,
		"git -c core.pager=less log":                CriticalSettings,
		"git --no-pager -C . push -f":               CriticalDeleting,
		"unlink /home/me/notes.txt":                 CriticalDeleting,
		"sed -i d /home/me/.bashrc":                 CriticalSettings,
		"sed -i.bak s/a/b/ /home/me/notes.txt":      CriticalDeleting,
		"sed --in-place -e 's/a/b/' /home/me/x.txt": CriticalDeleting,
		"gh api repos/o/r/issues -f title=x":        CriticalSendingOut,
		"gh api repos/o/r/issues -F body=@f":        CriticalSendingOut,
		"gh api repos/o/r/issues -X POST":           CriticalSendingOut,
		"gh api repos/o/r/issues --input body.json": CriticalSendingOut,
	} {
		item, reason, ok := CriticalHost(command(c), scope)
		wantCritical(t, want, c, item, reason, ok)
	}
	for _, c := range []string{
		"git -C . status", "git -C /home/me/repo log --oneline", "git --no-pager diff", "unlink scratch.txt",
		"sed -i s/a/b/ notes.md", "sed -n 1p /home/me/notes.txt", "sed s/a/b/ /home/me/notes.txt", "gh api repos/o/r/issues", "gh api user",
	} {
		item, reason, ok := CriticalHost(command(c), scope)
		wantFine(t, c, item, reason, ok)
	}
}

// A call that names several actions is as critical as its worst one.
func TestCriticalHostAlso(t *testing.T) {
	h := HostAction{Kind: HostFileWrite, Path: ws + "/a.txt", Also: []HostAction{{Kind: HostFileDelete, Path: "/home/me/Documents/thesis.md"}}}
	item, reason, ok := CriticalHost(h, scope)
	wantCritical(t, CriticalDeleting, "patch with an outside delete", item, reason, ok)
	h.Also = []HostAction{{Kind: HostFileWrite, Path: ws + "/b.txt"}}
	item, reason, ok = CriticalHost(h, scope)
	wantFine(t, "patch of two files in the folder", item, reason, ok)
}
