//go:build !windows

package lifeline

import (
	"os/signal"
	"syscall"
)

func ignoreBrokenPipe() { signal.Ignore(syscall.SIGPIPE) }
