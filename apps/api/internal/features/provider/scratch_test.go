package provider

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

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
		got := privateDir(dir)
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
		got := privateDir(dir)
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
		got := privateDir(link)
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
		got := privateDir(file)
		cleanFresh(got, file)
		if got == file || !mode(got).IsDir() {
			t.Fatalf("got %s", got)
		}
	})
}
