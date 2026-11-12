package agenthost

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// stageFolder makes a staged agent state for account the way agent-import
// leaves one: accounts/.restore-<dir>-<stamp>/ with RESTORE.json and a file.
func stageFolder(t *testing.T, sup *Supervisor, account, content string) Staged {
	t.Helper()
	dir := filepath.Join(sup.Layout().Accounts(), ".restore-"+AccountDirName(account)+"-20261111T120000Z-abcdef")
	writeFile(t, filepath.Join(dir, "memories", "USER.md"), content)
	writeFile(t, filepath.Join(dir, restoreMeta), `{"account_dir": "`+AccountDirName(account)+`"}`)
	return Staged{Account: account, Dir: dir, RestoredSkills: []string{"pantry-steps"}}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func entries(t *testing.T, dir string) []string {
	t.Helper()
	list, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

// CommitRestore stops the account's running worker before it swaps the
// staged folder in, keeps it from starting meanwhile, and leaves no marker,
// no staging file and no old home behind; another account's worker and its
// staged restore are untouched.
func TestCommitRestoreSuspendsTheWorkerAndSwapsTheHome(t *testing.T) {
	h := newHarness(t, "ok", nil)
	w := h.ensure("acct-1")
	other := h.ensure("acct-2")
	home := h.sup.Layout().Home("acct-1")
	writeFile(t, filepath.Join(home, "memories", "USER.md"), "old")
	writeFile(t, filepath.Join(home, "mcp-tokens", "server.json"), "old sign-in")
	staged := stageFolder(t, h.sup, "acct-1", "restored")
	theirs := stageFolder(t, h.sup, "acct-2", "theirs, waiting for its transaction")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := h.sup.CommitRestore(ctx, staged); err != nil {
		t.Fatal(err)
	}
	select {
	case <-w.Done():
	default:
		t.Fatal("the account's worker still runs after the swap")
	}
	if got := readFile(t, filepath.Join(home, "memories", "USER.md")); got != "restored" {
		t.Fatalf("USER.md = %q", got)
	}
	for _, gone := range []string{committedMarker, restoreMeta, "mcp-tokens"} {
		if _, err := os.Stat(filepath.Join(home, gone)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s is in the home after the swap", gone)
		}
	}
	if _, err := os.Stat(staged.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Error("the staged folder is still there")
	}
	if left := entries(t, h.sup.Layout().Trash()); len(left) != 0 {
		t.Errorf("the replaced home is left in .trash: %v", left)
	}
	if _, err := os.Stat(theirs.Dir); err != nil {
		t.Errorf("another account's staged restore was touched: %v", err)
	}
	if w2 := h.ensure("acct-2"); w2.PID() != other.PID() {
		t.Error("another account's worker was replaced")
	}
	// The suspension ends with the swap: the next Ensure starts a worker.
	if w2 := h.ensure("acct-1"); w2.PID() == w.PID() {
		t.Error("the old worker came back")
	}
}

// An account that never had a home gets the staged folder as its home.
func TestCommitRestoreWithoutAHome(t *testing.T) {
	sup := New(Config{Root: testRoot(t), Logf: newTestLog(t).logf})
	staged := stageFolder(t, sup, "acct-new", "restored")
	if err := sup.CommitRestore(context.Background(), staged); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, filepath.Join(sup.Layout().Home("acct-new"), "memories", "USER.md")); got != "restored" {
		t.Fatalf("USER.md = %q", got)
	}
}

// A staged folder whose name is not the account's (a helper answer pointing
// elsewhere) is never swapped in or deleted.
func TestStagedFolderMustBeTheAccounts(t *testing.T) {
	sup := New(Config{Root: testRoot(t), Logf: newTestLog(t).logf})
	mine := stageFolder(t, sup, "acct-1", "mine")
	outside := t.TempDir()
	cases := map[string]Staged{
		"another account's":   {Account: "acct-2", Dir: mine.Dir},
		"outside accounts/":   {Account: "acct-1", Dir: filepath.Join(outside, filepath.Base(mine.Dir))},
		"the live home":       {Account: "acct-1", Dir: sup.Layout().Home("acct-1")},
		"the accounts folder": {Account: "acct-1", Dir: sup.Layout().Accounts()},
		"a bare prefix":       {Account: "acct-1", Dir: filepath.Join(sup.Layout().Accounts(), ".restore-"+AccountDirName("acct-1")+"-")},
		"no account":          {Dir: mine.Dir},
	}
	for name, staged := range cases {
		if err := sup.CommitRestore(context.Background(), staged); err == nil {
			t.Errorf("%s: CommitRestore accepted %s", name, staged.Dir)
		}
		if err := sup.DiscardRestore(staged); err == nil {
			t.Errorf("%s: DiscardRestore accepted %s", name, staged.Dir)
		}
	}
	if _, err := os.Stat(mine.Dir); err != nil {
		t.Fatalf("the staged folder was touched: %v", err)
	}
	if err := sup.DiscardRestore(mine); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(mine.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("DiscardRestore left the staged folder")
	}
	if err := sup.DiscardRestore(mine); err != nil {
		t.Fatalf("discarding twice: %v", err)
	}
	if err := sup.CommitRestore(context.Background(), mine); err == nil || !strings.Contains(err.Error(), "gone") {
		t.Fatalf("committing a discarded restore: %v", err)
	}
}

// Exporting an account that never used the agent finds nothing to export
// without running anything; one with a home needs the runtime.
func TestExportStateWithoutAHomeOrARuntime(t *testing.T) {
	sup := New(Config{Root: testRoot(t), Logf: newTestLog(t).logf})
	if _, _, err := sup.ExportState(context.Background(), "acct-1", nil); !errors.Is(err, ErrNoAgentState) {
		t.Fatalf("no home: %v", err)
	}
	writeFile(t, filepath.Join(sup.Layout().Home("acct-1"), "memories", "USER.md"), "x")
	if _, _, err := sup.ExportState(context.Background(), "acct-1", nil); !errors.Is(err, ErrNoRuntime) {
		t.Fatalf("no runtime: %v", err)
	}
	if _, err := sup.StageRestore(context.Background(), "acct-1", []byte("zip")); !errors.Is(err, ErrNoRuntime) {
		t.Fatalf("stage without a runtime: %v", err)
	}
}

// scriptRuntime is a runtime whose helpers are a shell script: prepare
// answers ok, and the agent-state commands run body with $out (the
// --out or --zip path) and $accounts set.
func scriptRuntime(t *testing.T, body string) Runtime {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script helpers")
	}
	script := filepath.Join(t.TempDir(), "boot.sh")
	writeFile(t, script, `#!/bin/sh
cmd=$1; shift
root=""; out=""
while [ $# -gt 0 ]; do
  case $1 in
    --agent-dir) root=$2; shift ;;
    --out|--zip) out=$2; shift ;;
  esac
  shift
done
accounts="$root/accounts"
cat >/dev/null
if [ "$cmd" = prepare ]; then echo '{"ok": true}'; exit 0; fi
`+body+"\n")
	return Runtime{Program: "/bin/sh", Args: []string{script}}
}

func scriptSupervisor(t *testing.T, body string) *Supervisor {
	t.Helper()
	return New(Config{Root: testRoot(t), Runtime: scriptRuntime(t, body), Env: EnvConfig{Path: os.Getenv("PATH")}, Logf: newTestLog(t).logf})
}

// A zip above the cap is refused without reading it, a zip that does not
// hash to what the helper reported is refused, and a good one comes back
// with its sha256; the temporary zip never stays behind.
func TestExportStateChecksTheHelpersZip(t *testing.T) {
	cases := []struct {
		name, body string
		want       error
		wantText   string
	}{
		{"over the cap", `truncate -s 65M "$out"; echo '{"ok": true, "format": "timely-agent-state", "version": 1, "sha256": "x", "size": 68157440}'`, ErrStateTooLarge, "65 MB"},
		{"wrong sha256", `printf 'zip' > "$out"; echo '{"ok": true, "format": "timely-agent-state", "version": 1, "sha256": "00", "size": 3}'`, ErrHelperFailed, "sha256"},
		{"wrong format", `printf 'zip' > "$out"; echo '{"ok": true, "format": "other", "version": 1, "sha256": "x", "size": 3}'`, ErrHelperFailed, "format"},
		{"helper error", `echo '{"ok": false, "error": "BackupError: database busy"}'; exit 1`, ErrHelperFailed, "database busy"},
		{"good", `printf 'zip' > "$out"; echo "{\"ok\": true, \"format\": \"timely-agent-state\", \"version\": 1, \"sha256\": \"$(sha256sum "$out" | cut -d' ' -f1)\", \"size\": 3}"`, nil, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sup := scriptSupervisor(t, c.body)
			writeFile(t, filepath.Join(sup.Layout().Home("acct-1"), "memories", "USER.md"), "x")
			zip, sha, err := sup.ExportState(context.Background(), "acct-1", nil)
			if c.want != nil {
				if !errors.Is(err, c.want) || !strings.Contains(err.Error(), c.wantText) {
					t.Fatalf("err = %v, want %v with %q", err, c.want, c.wantText)
				}
			} else if err != nil || string(zip) != "zip" || len(sha) != 64 {
				t.Fatalf("zip %q sha %q err %v", zip, sha, err)
			}
			if left := entries(t, sup.Layout().HelperTemp()); len(left) != 0 {
				t.Errorf("left in the helper temp folder: %v", left)
			}
		})
	}
}

// StageRestore takes the helper's staged folder only when it is the
// account's, and removes the zip it handed the helper.
func TestStageRestoreChecksTheStagedFolder(t *testing.T) {
	good := `dir="$accounts/.restore-` + AccountDirName("acct-1") + `-20261111T120000Z-abcdef"; mkdir -p "$dir"
echo "{\"ok\": true, \"staged_dir\": \"$dir\", \"restored_skills\": [\"pantry-steps\"], \"dropped\": [\"config.yaml (never restored)\"], \"blocked\": [\"injected\"]}"`
	sup := scriptSupervisor(t, good)
	staged, err := sup.StageRestore(context.Background(), "acct-1", []byte("zip"))
	if err != nil {
		t.Fatal(err)
	}
	if staged.Account != "acct-1" || fmt.Sprint(staged.RestoredSkills) != "[pantry-steps]" || fmt.Sprint(staged.Blocked) != "[injected]" || len(staged.Dropped) != 1 {
		t.Fatalf("staged = %+v", staged)
	}
	if left := entries(t, sup.Layout().HelperTemp()); len(left) != 0 {
		t.Errorf("left in the helper temp folder: %v", left)
	}

	elsewhere := `echo "{\"ok\": true, \"staged_dir\": \"$accounts/` + AccountDirName("acct-1") + `\", \"restored_skills\": []}"`
	sup = scriptSupervisor(t, elsewhere)
	if _, err := sup.StageRestore(context.Background(), "acct-1", []byte("zip")); !errors.Is(err, ErrHelperFailed) {
		t.Fatalf("a staged folder that is the live home: %v", err)
	}
	if _, err := sup.StageRestore(context.Background(), "acct-1", nil); err == nil {
		t.Fatal("an empty zip was staged")
	}
}
