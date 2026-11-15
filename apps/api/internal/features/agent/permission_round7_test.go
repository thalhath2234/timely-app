package agent

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// Phase 5, review round 7: the allowlist's holes. A submodule's own git
// folder and a `.git/./config` spelling run a program through plain `git
// status`; rg, grep -d, diff and git diff --no-index print secret files
// without the secret walk; `..` after a symlink was judged lexically; an
// alternates file reads another repository.

func (f autoFixture) write(t *testing.T, rel, body string) {
	t.Helper()
	p := filepath.Join(f.work, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (f autoFixture) remove(t *testing.T, rel string) {
	t.Helper()
	if err := os.RemoveAll(filepath.Join(f.work, rel)); err != nil {
		t.Fatal(err)
	}
}

// gitIndexWith is a version 2 git index with one entry per (name, mode).
func gitIndexWith(entries map[string]uint32) []byte {
	b := []byte("DIRC")
	b = binary.BigEndian.AppendUint32(b, 2)
	b = binary.BigEndian.AppendUint32(b, uint32(len(entries)))
	for name, mode := range entries {
		e := make([]byte, 62)
		binary.BigEndian.PutUint32(e[24:], mode)
		binary.BigEndian.PutUint16(e[60:], uint16(len(name)))
		e = append(e, name...)
		e = append(e, 0)
		for len(e)%8 != 0 {
			e = append(e, 0)
		}
		b = append(b, e...)
	}
	return append(b, make([]byte, 20)...)
}

func TestAutoGitSubmodulesAsk(t *testing.T) {
	f := newAutoFixture(t)
	f.safe(t, f.scope, "git status", "git diff", "git log")
	// a .gitmodules file, a .git/modules folder or a gitlink in the index
	f.write(t, ".gitmodules", "[submodule \"vendor/lib\"]\n\tpath = vendor/lib\n")
	f.asks(t, f.scope, "git status", "git status --short", "git diff", "git log", "git show", "git ls-files", "git branch")
	// git status and git diff skip the submodules when told to
	f.safe(t, f.scope, "git status --ignore-submodules=all", "git diff --ignore-submodules=all --stat")
	f.asks(t, f.scope, "git status --ignore-submodules", "git status --ignore-submodules=dirty", "git diff --ignore-submodules=untracked", "git log --ignore-submodules=all")
	f.remove(t, ".gitmodules")
	f.write(t, ".git/modules/vendor/lib/config", "[core]\n")
	f.asks(t, f.scope, "git status", "git diff")
	f.remove(t, ".git/modules")
	f.safe(t, f.scope, "git status")
	f.write(t, ".git/index", string(gitIndexWith(map[string]uint32{"a.txt": 0o100644, "vendor/lib": 0o160000})))
	f.asks(t, f.scope, "git status", "git diff", "git log")
	f.safe(t, f.scope, "git status --ignore-submodules=all")
	f.write(t, ".git/index", string(gitIndexWith(map[string]uint32{"a.txt": 0o100644})))
	f.safe(t, f.scope, "git status", "git diff")
	// an index Timely can't read asks
	f.write(t, ".git/index", "DIRC\x00\x00\x00\x04")
	f.asks(t, f.scope, "git status")
	f.remove(t, ".git/index")
	// the options that recurse into submodules are not on the list
	f.asks(t, f.scope, "git ls-files --recurse-submodules", "git diff --submodule", "git diff --submodule=diff", "git log --submodule")
}

func TestAutoGitRepositoryPointersAndSettingsAsk(t *testing.T) {
	f := newAutoFixture(t)
	f.write(t, ".git/objects/info/alternates", "/elsewhere/.git/objects\n")
	f.asks(t, f.scope, "git show abcd1234", "git log -p", "git status")
	f.remove(t, ".git/objects/info")
	f.write(t, ".git/objects/info/http-alternates", "https://x\n")
	f.asks(t, f.scope, "git log")
	f.remove(t, ".git/objects/info")
	f.write(t, ".git/shallow", "abc\n")
	f.asks(t, f.scope, "git log")
	f.remove(t, ".git/shallow")
	f.write(t, ".git/info/grafts", "abc\n")
	f.asks(t, f.scope, "git log")
	f.remove(t, ".git/info")
	f.safe(t, f.scope, "git log", "git status")
	// a repository setting that names a program
	for _, cfg := range []string{
		"[core]\n\tfsmonitor = \"touch x\"\n",
		"[core]\n\tFsMonitor=true\n",
		"[core]\n\tbare = false\n[diff \"x\"]\n\ttextconv = sh\n",
		"[diff]\n\texternal = ./x\n",
		"[core] pager = sh\n",
		"[filter \"f\"]\n\tsmudge = x\n",
		"[log]\n\tshowSignature = true\n",
		"[gpg]\n\tprogram = x\n",
		"[core]\n\thooksPath = /tmp/x\n",
	} {
		f.write(t, ".git/config", cfg)
		f.asks(t, f.scope, "git status", "git log")
	}
	f.write(t, ".git/config", "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = https://example.com/x.git\n[user]\n\tname = x\n")
	f.safe(t, f.scope, "git status", "git log")
	// a signature placeholder runs gpg
	f.asks(t, f.scope, "git log --format=%G?", "git log --pretty=format:%GS", "git show --format='%h %GK'")
	f.safe(t, f.scope, "git log --format=%h", "git log --format='%h %s'")
}

func TestAutoGitPathspecMagicAsks(t *testing.T) {
	f := newAutoFixture(t)
	f.asks(t, f.scope, "git log -p -- '*env'", "git log -p -- '.en*'", "git log -p -- ':(glob)**'", "git log -p -- ':!sub'", "git diff -- 'a?'", "git log -- '[.]env'")
	f.safe(t, f.scope, "git log -p -- notes.md", "git show HEAD:notes.md", "git log HEAD~2..HEAD", "git log -p -- sub")
}

func TestCriticalHostGitInternalsAreSettings(t *testing.T) {
	f := newAutoFixture(t)
	abs := func(p string) string { return filepath.Join(f.work, p) }
	for _, p := range []string{
		".git/config", ".git/./config", ".git//config", "./.git/./config", "sub/.git/./config", ".git/./hooks/pre-commit", ".git/modules/x/./config",
		".git/modules/vendor/lib/config", ".git/modules/a/modules/b/config", ".git/modules/vendor/lib/hooks/pre-commit",
		"vendor/lib/.git", "sub/.git", ".git", ".gitmodules", "sub/.gitmodules",
		".git/objects/info/alternates", ".git/modules/vendor/lib/objects/info/alternates", ".git/config.worktree", ".git/info/exclude", ".git/index", ".git/refs/replace/x",
		"sub/../.git/config", "x/../.git/./config",
		abs(".git/./config"), abs(".git/modules/vendor/lib/config"), abs("vendor/lib/.git"), abs("sub/../.git/config"),
	} {
		for _, kind := range []string{HostFileWrite} {
			item, reason, ok := CriticalHost(HostAction{Kind: kind, Path: p}, f.scope)
			wantCritical(t, CriticalSettings, "write "+p, item, reason, ok)
		}
	}
	// a file that only looks like one
	for _, p := range []string{"notes.md", "sub/x.txt", "git/config", "gitmodules", "my.git/x", "x.gitmodules.bak", ".github/workflows/ci.yml", ".gitignore"} {
		item, reason, ok := CriticalHost(HostAction{Kind: HostFileWrite, Path: p}, f.scope)
		wantFine(t, "write "+p, item, reason, ok)
	}
	// a command that writes them
	critical(t, CriticalSettings, f.scope, "echo x > .git/./config", "cp x .git/./hooks/pre-commit")
}

func TestAutoRgSearchesHiddenFilesWhateverIgnoreFilesSay(t *testing.T) {
	f := newAutoFixture(t)
	// the fixture's folder holds a .env; everything that could un-hide it asks
	f.asks(t, f.scope,
		"rg -t sh -i token", "rg -tsh token", "rg --type=sh token", "rg -g .env -i token", "rg -g '*' -i token", "rg --glob=.env token", "rg --iglob .env token",
		"rg token", "rg token sub", "rg -uu token")
	f.write(t, "clean/.ignore", "!.env\n")
	f.write(t, "clean/.env", "API_TOKEN=x")
	f.asks(t, f.scope, "rg token clean", "rg -i token clean")
	f.remove(t, "clean/.env")
	f.remove(t, "clean/.ignore")
	f.safe(t, f.scope, "rg token clean", "rg -g '*.txt' token clean", "rg --files clean")
	// a plain search in a repository does not read .git/config, but any way
	// to whitelist it does
	f.remove(t, ".env")
	f.remove(t, "server.pem")
	f.remove(t, "sub/.env.local")
	f.remove(t, "bare")
	f.remove(t, "pointer")
	f.remove(t, "inj")
	f.safe(t, f.scope, "rg token", "rg -n token notes.md", "rg token sub")
	f.asks(t, f.scope, "rg -g '*' token", "rg --hidden token", "rg -. token", "rg -u token", "rg --no-ignore token", "rg --iglob '.*' token")
	f.write(t, ".ignore", "!.git\n")
	f.asks(t, f.scope, "rg token")
	f.safe(t, f.scope, "rg token sub") // no .git folder under sub
	f.remove(t, ".ignore")
	f.write(t, "sub/.rgignore", "!.*\n")
	f.asks(t, f.scope, "rg token")
	f.remove(t, "sub/.rgignore")
	f.write(t, ".gitignore", "build/\n!keep.txt\n")
	f.safe(t, f.scope, "rg token")
}

func TestAutoFolderOperandsReadWholeTrees(t *testing.T) {
	f := newAutoFixture(t)
	f.asks(t, f.scope,
		"grep --directories recurse -i token", "grep --directories=rec -i token", "ls | grep --directories recurse token", "grep -d recurse token", "grep -drecurse token", "grep -D read token",
		"diff -N . sub", "diff --new-file . sub", "diff . sub", "diff -N clean .", "diff sub clean", "cmp . sub",
		"git diff --no-index clean .", "git diff --no-index -- clean .", "git diff --no-index sub clean", "git diff --no-index notes.md sub/x.txt")
	// files are still fine
	f.safe(t, f.scope, "diff notes.md sub/x.txt", "diff -N notes.md sub/x.txt", "cmp notes.md sub/x.txt", "grep -n TODO notes.md", "grep -c TODO notes.md data.csv")
}

func TestAutoDotDotAfterALinkIsJudgedWhereTheKernelLandsIt(t *testing.T) {
	f := newAutoFixture(t)
	if err := os.WriteFile(filepath.Join(f.home, "diary.txt"), []byte("private"), 0o644); err != nil {
		t.Fatal(err)
	}
	// out -> ~/Documents, so out/.. is the home; up -> ~, so up/.. is above it
	f.asks(t, f.scope,
		"cat out/../diary.txt", "tail -n 5 out/../diary.txt", "diff -N notes.md out/../diary.txt", "ls -la out/..", "ls out/../", "head out/../notes.txt",
		"git -C out/.. status", "git diff --no-index notes.md out/../diary.txt", "find out/.. -name x", "cd out/.. && ls", "stat out/../diary.txt",
		"cat "+f.work+"/out/../diary.txt", "cat up/../x", "ls up/../..", "cat sub/../out/../diary.txt")
	// a .. that does not follow a link is the same lexically
	f.safe(t, f.scope, "cat sub/../notes.md", "ls sub/..", "git -C sub/.. status", "cat clean/../sub/x.txt", "ls ./sub/./..")
	// write_file, patch and rm judge it the same way
	for _, p := range []string{"out/../evil.txt", f.work + "/out/../evil.txt", "sub/../out/../evil.txt"} {
		item, reason, ok := CriticalHost(HostAction{Kind: HostFileWrite, Path: p}, f.scope)
		wantCritical(t, CriticalDeleting, "write "+p, item, reason, ok)
	}
	for _, p := range []string{"sub/../x.txt", "clean/../sub/new.txt"} {
		item, reason, ok := CriticalHost(HostAction{Kind: HostFileWrite, Path: p}, f.scope)
		wantFine(t, "write "+p, item, reason, ok)
	}
	critical(t, CriticalDeleting, f.scope, "rm out/../x", "rm -r out/../x", "mv notes.md out/../x")
	// the link's own name is still followed for a delete
	item, reason, ok := CriticalHost(HostAction{Kind: HostFileDelete, Path: "out"}, f.scope)
	wantFine(t, "delete the link out", item, reason, ok)
}

// bash looks a bare cd target up through CDPATH, so only ./x, ../x and
// absolute targets are known to be where they say.
func TestAutoCdBareNameAsks(t *testing.T) {
	f := newAutoFixture(t)
	f.asks(t, f.scope, "cd sub && ls", "cd clean && cat a.txt", "cd sub")
	f.safe(t, f.scope, "cd ./sub && ls", "cd ../work/sub && ls", "cd "+filepath.Join(f.work, "sub")+" && ls", "cd . && ls", "git -C sub status")
}
