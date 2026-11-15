package instance

import (
	"os"
	"path/filepath"
	"testing"
)

// A working folder that is a link to the home (or a folder above it) is
// refused like the home itself, and a link to an ordinary folder is stored as
// the folder it leads to.
func TestValidateWorkingDirFollowsLinks(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	home := filepath.Join(root, "home", "me")
	proj := filepath.Join(home, "proj")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	toHome, toAbove, toProj := filepath.Join(root, "l1"), filepath.Join(root, "l2"), filepath.Join(root, "l3")
	for link, target := range map[string]string{toHome: home, toAbove: filepath.Dir(home), toProj: proj} {
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
	}
	for _, link := range []string{toHome, toAbove} {
		if got, err := ValidateWorkingDir(link); err == nil {
			t.Errorf("a link to the home or above it was accepted: %q", got)
		}
	}
	if got, err := ValidateWorkingDir(toProj); err != nil || got != proj {
		t.Errorf("a link to a project folder: %q, %v (want %q)", got, err, proj)
	}
}
