package bots

import (
	"os"
	"testing"
	"time"
)

// The tests write their times in UTC, and a person with no zone set gets the
// server's. Pin the server's zone so a machine outside UTC checks the same
// days and brief times as CI.
func TestMain(m *testing.M) {
	time.Local = time.UTC
	os.Exit(m.Run())
}
