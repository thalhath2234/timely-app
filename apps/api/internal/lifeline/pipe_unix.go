//go:build !windows

package lifeline

import (
	"os"
	"os/signal"
	"syscall"
)

// Notify, not Ignore: an ignored SIGPIPE would be inherited by the programs
// the API starts (agent CLIs), breaking `yes | head` style pipelines there.
// Catching it only changes this process: a write to the closed log pipe
// returns EPIPE instead of killing the API mid-shutdown.
func ignoreBrokenPipe() { signal.Notify(make(chan os.Signal, 1), syscall.SIGPIPE) }
