//go:build linux

package procguard

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"strings"
	"testing"
)

const childEnv = "PROCGUARD_TEST_CHILD"

// TestMain lets the test binary act as the API: with childEnv set it hardens
// itself (or not), says so on stdout and waits for stdin to close.
func TestMain(m *testing.M) {
	if mode := os.Getenv(childEnv); mode != "" {
		getenv := func(k string) string {
			if k == "TIMELY_LIFELINE" && mode == "desktop" {
				return "stdin"
			}
			return ""
		}
		hardened, err := Harden(getenv)
		fmt.Printf("hardened=%v err=%v\n", hardened, err)
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// startChild starts this binary as a fake API holding a secret in its
// environment and returns its pid once it reported back.
func startChild(t *testing.T, mode string) (int, string) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	cmd.Env = []string{childEnv + "=" + mode, "JWT_SECRET=procguard-probe-not-a-secret"}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = stdin.Close()
		_ = cmd.Wait()
	})
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil {
		t.Fatalf("child said nothing: %v", err)
	}
	return cmd.Process.Pid, strings.TrimSpace(line)
}

func TestHardenHidesTheEnvironmentFromTheSameUID(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads every /proc/<pid>/environ")
	}
	pid, said := startChild(t, "server")
	if said != "hardened=true err=<nil>" {
		t.Fatalf("child: %s", said)
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/environ", pid))
	if !errors.Is(err, fs.ErrPermission) {
		t.Fatalf("read the hardened process's environ: err=%v, %d bytes (want permission denied)", err, len(data))
	}
}

func TestHardenLeavesADesktopSidecarReadable(t *testing.T) {
	pid, said := startChild(t, "desktop")
	if said != "hardened=false err=<nil>" {
		t.Fatalf("child: %s", said)
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/environ", pid))
	if err != nil || !strings.Contains(string(data), "JWT_SECRET=procguard-probe-not-a-secret") {
		t.Fatalf("the desktop's orphan sweep must read a sidecar's environ: err=%v", err)
	}
}
