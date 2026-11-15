package instance

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The working folder is where Auto deletes and overwrites without asking, so
// the disk's root, the home and a folder above the home are refused (review
// round 2).
func TestValidateWorkingDirRefusesTheRootTheHomeAndAboveIt(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		t.Skip("no home folder")
	}
	for _, bad := range []string{string(filepath.Separator), home, home + string(filepath.Separator), filepath.Dir(home)} {
		if got, err := ValidateWorkingDir(bad); err == nil {
			t.Errorf("%q was accepted as %q", bad, got)
		} else if !strings.Contains(err.Error(), "Pick a project folder") {
			t.Errorf("%q: %v", bad, err)
		}
	}
	// a folder inside the home is fine
	inside := filepath.Join(t.TempDir(), "proj")
	if err := os.MkdirAll(inside, 0o700); err != nil {
		t.Fatal(err)
	}
	if rel, rerr := filepath.Rel(home, inside); rerr == nil && !strings.HasPrefix(rel, "..") {
		if got, err := ValidateWorkingDir(inside); err != nil || got != inside {
			t.Errorf("a project folder inside the home: %q %v", got, err)
		}
	}
	if got, err := ValidateWorkingDir(""); err != nil || got != "" {
		t.Errorf("the empty folder (use the agent's own): %q %v", got, err)
	}
}
