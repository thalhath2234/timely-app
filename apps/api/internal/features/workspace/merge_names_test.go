package workspace

import (
	"errors"
	"testing"
)

// A merge offered by smart suggestions carries the names the person saw. A
// label renamed elsewhere since then must not be merged under its old name.
func TestMergeRefusesANameThatChangedSinceItWasShown(t *testing.T) {
	saved := map[string]string{"l_urgent": "Waiting on client", "l_bang": "Urgent!"}
	req := mergeRequest{Into: "l_urgent", FromName: "Urgent!", IntoName: "urgent"}
	err := checkNames(req, "l_bang", saved)
	var renamed renamedError
	if !errors.As(err, &renamed) || renamed.shown != "urgent" || renamed.now != "Waiting on client" {
		t.Fatalf("got %v", err)
	}
	if got := err.Error(); got != "“urgent” is now called “Waiting on client”, so nothing was merged." {
		t.Fatalf("message %q", got)
	}
}

func TestMergeKeepsWorkingForTheSameNamesAndOlderApps(t *testing.T) {
	saved := map[string]string{"l_urgent": "Urgent", "l_bang": "Urgent!"}
	// Re-capitalised or spaced: still the label the person saw.
	if err := checkNames(mergeRequest{Into: "l_urgent", FromName: " urgent! ", IntoName: "urgent"}, "l_bang", saved); err != nil {
		t.Fatal(err)
	}
	// An app that sends no names merges by id, as before.
	if err := checkNames(mergeRequest{Into: "l_urgent"}, "l_bang", saved); err != nil {
		t.Fatal(err)
	}
}

func TestMergeSaysWhenTheShownItemWasDeleted(t *testing.T) {
	err := checkNames(mergeRequest{Into: "l_urgent", FromName: "Urgent!", IntoName: "urgent"}, "l_bang", map[string]string{"l_urgent": "urgent"})
	if err == nil || err.Error() != "“Urgent!” was deleted, so nothing was merged." {
		t.Fatalf("got %v", err)
	}
}
