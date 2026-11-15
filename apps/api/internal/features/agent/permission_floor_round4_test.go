package agent

import (
	"os"
	"path/filepath"
	"testing"
)

// Phase 5, review round 4: the floor follows symlinks like the critical list
// does. A link to the home inside the agent's folder, or a working folder
// that is itself a link to the home, must not hide a delete of the home.
func TestHardlineFloorFollowsLinks(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	home := filepath.Join(root, "home", "me")
	work := filepath.Join(home, "work")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(home, filepath.Join(work, "h")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Dir(home), filepath.Join(work, "up")); err != nil {
		t.Fatal(err)
	}
	// a link to the home from outside it, used as the agent's folder
	elsewhere := filepath.Join(root, "proj")
	if err := os.MkdirAll(elsewhere, 0o755); err != nil {
		t.Fatal(err)
	}
	homeLink := filepath.Join(elsewhere, "homelink")
	if err := os.Symlink(home, homeLink); err != nil {
		t.Fatal(err)
	}
	scope := HostScope{Workspace: work, Home: home}
	for _, c := range []string{
		"rm -rf h/*", "cd h && rm -rf *", "rm -rf h/", "rm -rf h", "find h/ -delete", "rm -rf ./h/.", "rm -rf up", "rm -rf up/*",
		"chmod -R 777 h", "mv h /tmp/x",
	} {
		if _, ok := HardlineHost(HostAction{Kind: HostTerminal, Command: c}, scope); !ok {
			t.Errorf("%q through a link to the home is not on the floor", c)
		}
	}
	// the same with a folder that is a link to the home
	linked := HostScope{Workspace: homeLink, Home: home}
	for _, c := range []string{"rm -rf *", "rm -rf .", "rm -rf ./*"} {
		if _, ok := HardlineHost(HostAction{Kind: HostTerminal, Command: c, Cwd: homeLink}, linked); !ok {
			t.Errorf("%q in a folder that is a link to the home is not on the floor", c)
		}
	}
	// ordinary work in the folder stays off the floor
	for _, c := range []string{"rm -rf build", "rm -rf work2/*", "ls h", "cat h/notes.txt"} {
		if _, ok := HardlineHost(HostAction{Kind: HostTerminal, Command: c}, scope); ok {
			t.Errorf("%q is on the floor", c)
		}
	}
}
