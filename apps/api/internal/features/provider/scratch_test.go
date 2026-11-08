package provider

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"timely-api/internal/features/chat"
)

func mustPrivateDir(t *testing.T, dir string) string {
	t.Helper()
	got, err := privateDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestPrivateDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no Unix mode bits or owner to check")
	}
	base := t.TempDir()
	cleanFresh := func(got, want string) {
		if got != want {
			t.Cleanup(func() { os.RemoveAll(got) })
		}
	}
	mode := func(dir string) os.FileMode {
		info, err := os.Lstat(dir)
		if err != nil {
			t.Fatal(err)
		}
		return info.Mode()
	}

	t.Run("creates a missing directory as 0700", func(t *testing.T) {
		dir := filepath.Join(base, "missing")
		got := mustPrivateDir(t, dir)
		cleanFresh(got, dir)
		if got != dir || mode(dir).Perm() != 0o700 {
			t.Fatalf("got %s mode %v", got, mode(got))
		}
	})

	t.Run("tightens an own directory that is too open", func(t *testing.T) {
		dir := filepath.Join(base, "open")
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(dir, 0o777); err != nil {
			t.Fatal(err)
		}
		got := mustPrivateDir(t, dir)
		cleanFresh(got, dir)
		if got != dir || mode(dir).Perm() != 0o700 {
			t.Fatalf("got %s mode %v", got, mode(dir))
		}
	})

	t.Run("refuses a symlink in its place", func(t *testing.T) {
		target := filepath.Join(base, "elsewhere")
		if err := os.Mkdir(target, 0o700); err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(base, "link")
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
		got := mustPrivateDir(t, link)
		cleanFresh(got, link)
		if got == link || got == target {
			t.Fatalf("a symlinked scratch directory was kept: %s", got)
		}
		if m := mode(got); !m.IsDir() || m.Perm() != 0o700 {
			t.Fatalf("the fresh directory %s has mode %v", got, m)
		}
	})

	t.Run("refuses a file in its place", func(t *testing.T) {
		file := filepath.Join(base, "file")
		if err := os.WriteFile(file, nil, 0o600); err != nil {
			t.Fatal(err)
		}
		got := mustPrivateDir(t, file)
		cleanFresh(got, file)
		if got == file || !mode(got).IsDir() {
			t.Fatalf("got %s", got)
		}
	})
}

// failMkdirTemp makes the fresh-directory fallback fail until the test ends.
func failMkdirTemp(t *testing.T) {
	t.Helper()
	prev := mkdirTemp
	mkdirTemp = func(string, string) (string, error) { return "", errors.New("disk full") }
	t.Cleanup(func() { mkdirTemp = prev })
}

// unsafeScratch points the temp directory at a fresh folder whose fixed
// scratch name is a symlink, forgets any cached scratch directory, and
// restores both when the test ends.
func unsafeScratch(t *testing.T) (fixed, target string) {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	target = filepath.Join(tmp, "attacker")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	fixed = filepath.Join(tmp, "timely-agent-cli")
	if err := os.Symlink(target, fixed); err != nil {
		t.Fatal(err)
	}
	scratch.Lock()
	prev := scratch.dir
	scratch.dir = ""
	scratch.Unlock()
	t.Cleanup(func() {
		scratch.Lock()
		scratch.dir = prev
		scratch.Unlock()
	})
	return fixed, target
}

func TestPrivateDirFailsClosed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no Unix mode bits or owner to check")
	}
	failMkdirTemp(t)
	base := t.TempDir()

	target := filepath.Join(base, "elsewhere")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(base, "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	for name, dir := range map[string]string{"symlink": link, "file": file} {
		got, err := privateDir(dir)
		if err == nil || got != "" {
			t.Fatalf("%s: an unsafe directory was handed back: %q, %v", name, got, err)
		}
	}
}

func TestScratchDirRetriesAfterFailure(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no Unix mode bits or owner to check")
	}
	fixed, target := unsafeScratch(t)
	failMkdirTemp(t)

	if got, err := scratchDir(); err == nil || got != "" {
		t.Fatalf("scratchDir used an unsafe directory: %q, %v", got, err)
	}

	// The failure is not remembered: once a fresh directory can be made, the
	// next call gets one, and it is neither the symlink nor its target.
	mkdirTemp = os.MkdirTemp
	got, err := scratchDir()
	if err != nil {
		t.Fatalf("scratchDir did not retry: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(got) })
	if got == fixed || got == target {
		t.Fatalf("scratchDir handed back the unsafe directory %s", got)
	}
}

func TestCompleteFailsWithoutSafeScratchDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake CLIs are /bin/sh scripts, which Windows cannot execute")
	}
	messages := []chat.WireMessage{{Role: "system", Content: "rules"}, {Role: "user", Content: "hi"}}
	for _, tc := range []struct {
		name string
		p    func(bin string) chat.Completer
		want string
	}{
		{"claude", func(bin string) chat.Completer { return &Claude{Bin: bin, Model: "sonnet"} }, "Claude could not start"},
		{"codex", func(bin string) chat.Completer { return &Codex{Bin: bin, Model: "gpt-5"} }, "Codex could not start"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, target := unsafeScratch(t)
			failMkdirTemp(t)
			bin, argsFile := fakeCLI(t, tc.name, `echo '{}'`)

			_, err := tc.p(bin).Complete(context.Background(), messages, tools, false)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("got %v, want %q", err, tc.want)
			}
			if _, err := os.Stat(argsFile); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("the CLI ran without a safe scratch directory: %v", err)
			}
			if entries, _ := os.ReadDir(target); len(entries) != 0 {
				t.Fatalf("files were written into the unsafe directory: %v", entries)
			}
		})
	}
}
