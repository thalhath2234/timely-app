package utils

import (
	"path/filepath"
	"testing"
)

func TestResolveDataPathWithoutDataDir(t *testing.T) {
	t.Setenv("TIMELY_DATA_DIR", "")
	t.Setenv("X_DIR", "")
	if got := ResolveDataPath("X_DIR", "backups", "data/backups"); got != "data/backups" {
		t.Fatalf("fallback: got %q", got)
	}
	if got := ResolveDataPath("X_DIR", "backups", ""); got != "backups" {
		t.Fatalf("no fallback: got %q", got)
	}
	t.Setenv("X_DIR", "rel/dir")
	if got := ResolveDataPath("X_DIR", "backups", "data/backups"); got != "rel/dir" {
		t.Fatalf("relative env without data dir: got %q", got)
	}
	t.Setenv("X_DIR", "/abs/dir")
	if got := ResolveDataPath("X_DIR", "backups", "data/backups"); got != "/abs/dir" {
		t.Fatalf("absolute env: got %q", got)
	}
}

func TestResolveDataPathWithDataDir(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TIMELY_DATA_DIR", root)
	t.Setenv("X_DIR", "")
	if got := ResolveDataPath("X_DIR", "backups", "data/backups"); got != filepath.Join(root, "backups") {
		t.Fatalf("default under data dir: got %q", got)
	}
	t.Setenv("X_DIR", "custom")
	if got := ResolveDataPath("X_DIR", "backups", "data/backups"); got != filepath.Join(root, "custom") {
		t.Fatalf("relative env under data dir: got %q", got)
	}
	t.Setenv("X_DIR", "/elsewhere")
	if got := ResolveDataPath("X_DIR", "backups", "data/backups"); got != "/elsewhere" {
		t.Fatalf("absolute env with data dir: got %q", got)
	}
	if DataDir() != root {
		t.Fatalf("DataDir() = %q", DataDir())
	}
}
