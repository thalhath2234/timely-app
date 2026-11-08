//go:build !windows

package agenthost

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// The worker leads its own process group, so a stop reaches the children it
// started without start_new_session. Hermes starts terminal commands in new
// sessions; the worker kills those itself when its pipe closes (plan 6.2).
func configureCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

type procGroup struct {
	pgid int
}

func startGroup(cmd *exec.Cmd) (*procGroup, error) {
	return &procGroup{pgid: cmd.Process.Pid}, nil
}

func (g *procGroup) signal(sig syscall.Signal) error {
	if g == nil || g.pgid <= 0 {
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

// kill ends the whole group (SIGKILL). The supervisor calls it before
// reaping the leader, so the group id cannot have been reused yet.
func (g *procGroup) kill() error { return g.signal(syscall.SIGKILL) }

func (g *procGroup) release() {}

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
