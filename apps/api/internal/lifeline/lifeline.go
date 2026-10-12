// Package lifeline lets the desktop app's API sidecar exit when the app is
// gone. The app holds the write end of a pipe on the API's stdin and never
// writes to it; when the app exits for any reason (quit, crash, OOM kill, a
// lost Wayland/X session) the OS closes that end and stdin reads EOF.
// Without this an orphaned API kept running after the window was gone.
package lifeline

import (
	"io"
	"os"
	"strings"
)

// EnvVar switches the watch on. The desktop supervisor sets it to "stdin";
// servers started any other way (make dev, Docker) leave it unset, because
// their stdin may be a terminal or already at EOF.
const EnvVar = "TIMELY_LIFELINE"

// Enabled reports whether EnvVar asks for the stdin lifeline.
func Enabled(getenv func(string) string) bool {
	return strings.TrimSpace(getenv(EnvVar)) == "stdin"
}

// Watch returns a channel that closes once r reaches EOF or fails, meaning
// the process that owns the other end of the pipe has exited.
func Watch(r io.Reader) <-chan struct{} {
	gone := make(chan struct{})
	go func() {
		defer close(gone)
		_, _ = io.Copy(io.Discard, r)
	}()
	return gone
}

// FromEnv watches os.Stdin when EnvVar asks for it; nil (blocks forever in a
// select) otherwise. With the watch on, a write to the app's closed log pipe
// returns an error instead of killing the process with SIGPIPE, so the API
// still shuts down cleanly (stopping agent runs and their CLI children).
func FromEnv() <-chan struct{} {
	if !Enabled(os.Getenv) {
		return nil
	}
	ignoreBrokenPipe()
	return Watch(os.Stdin)
}
