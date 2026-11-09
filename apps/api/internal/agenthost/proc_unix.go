//go:build !windows

package agenthost

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// The worker leads its own process group, so a stop reaches the children it
// started without start_new_session. Hermes starts terminal commands in new
// sessions; the worker kills those itself when its pipe closes (plan 6.2).
func configureCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// configureWorkerCmd is configureCmd for the long-lived worker (Windows starts
// it suspended until it is in its Job Object).
func configureWorkerCmd(cmd *exec.Cmd) { configureCmd(cmd) }

type procGroup struct {
	mu     sync.Mutex
	pgid   int
	reaped bool // set before the leader is reaped: the group id may be reused after that
}

func startGroup(cmd *exec.Cmd) (*procGroup, error) {
	return &procGroup{pgid: cmd.Process.Pid}, nil
}

func (g *procGroup) signal(sig syscall.Signal) error {
	if g == nil {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.pgid <= 0 || g.reaped {
		return nil
	}
	err := syscall.Kill(-g.pgid, sig)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

// terminate asks the whole group to stop (SIGTERM).
func (g *procGroup) terminate() error { return g.signal(syscall.SIGTERM) }

// kill ends the whole group (SIGKILL). Once markReaped has run it does
// nothing, so a late stop timer never signals a reused group id.
func (g *procGroup) kill() error { return g.signal(syscall.SIGKILL) }

// markReaped is called right before the leader is reaped (cmd.Wait); every
// later terminate or kill is a no-op.
func (g *procGroup) markReaped() {
	if g == nil {
		return
	}
	g.mu.Lock()
	g.reaped = true
	g.mu.Unlock()
}

func (g *procGroup) release() {}

// contains reports whether pid is in the worker's process group.
func (g *procGroup) contains(pid int) (bool, error) {
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return false, err
	}
	return pgid == g.pgid, nil
}

// awaitExit waits up to d for the leader to exit without reaping it, so the
// group id stays reserved for the kill that follows.
func (g *procGroup) awaitExit(pid int, d time.Duration) {
	deadline := time.Now().Add(d)
	for !processExited(pid) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
}

// processExited reports whether pid has exited; a zombie waiting to be
// reaped counts (read from /proc on Linux; elsewhere only a reaped process
// counts, so awaitExit waits its full time).
func processExited(pid int) bool {
	if errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
		return true
	}
	stat, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return false
	}
	if i := bytes.LastIndexByte(stat, ')'); i >= 0 && i+2 < len(stat) {
		return stat[i+2] == 'Z'
	}
	return false
}

// canTerminate reports whether terminate is a real graceful signal.
const canTerminate = true
