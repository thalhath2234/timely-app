//go:build windows

package agenthost

import (
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// Windows has no process groups to signal. Each worker goes into its own Job
// Object with KILL_ON_JOB_CLOSE: terminating the job ends the worker and every
// process it started, and if the API itself dies the OS closes the job handle
// and does the same. CREATE_NO_WINDOW keeps a console from flashing up on the
// desktop app.
//
// The worker is assigned to the job right after it starts, so a child started
// in that first instant would escape; the worker imports for about a second
// before it can start anything.

const (
	createNewProcessGroup = 0x00000200
	createNoWindow        = 0x08000000

	processSetQuota                = 0x0100
	processTerminate               = 0x0001
	processQueryLimitedInformation = 0x1000
	synchronize                    = 0x00100000
	stillActive                    = 259

	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x00002000
)

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject       = kernel32.NewProc("TerminateJobObject")
)

type jobBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobExtendedLimitInformation struct {
	BasicLimitInformation jobBasicLimitInformation
	// On 32-bit Windows the C basic struct is 8-aligned (LARGE_INTEGER), so
	// IoInfo starts 4 bytes later than Go would put it; empty on 64-bit. (A
	// zero-size field here, unlike at the end of a struct, adds no padding.)
	_                     [8 - unsafe.Sizeof(uintptr(0))]byte
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

func configureCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: createNewProcessGroup | createNoWindow,
		HideWindow:    true,
	}
}

type procGroup struct {
	cmd  *exec.Cmd
	mu   sync.Mutex
	job  syscall.Handle
	open bool
}

func startGroup(cmd *exec.Cmd) (*procGroup, error) {
	g := &procGroup{cmd: cmd}
	r, _, err := procCreateJobObjectW.Call(0, 0)
	if r == 0 {
		return g, fmt.Errorf("CreateJobObject: %w", err)
	}
	job := syscall.Handle(r)
	var info jobExtendedLimitInformation
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	r, _, err = procSetInformationJobObject.Call(uintptr(job), jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))
	if r == 0 {
		_ = syscall.CloseHandle(job)
		return g, fmt.Errorf("SetInformationJobObject: %w", err)
	}
	process, err := syscall.OpenProcess(processSetQuota|processTerminate, false, uint32(cmd.Process.Pid))
	if err != nil {
		_ = syscall.CloseHandle(job)
		return g, fmt.Errorf("OpenProcess: %w", err)
	}
	r, _, err = procAssignProcessToJobObject.Call(uintptr(job), uintptr(process))
	_ = syscall.CloseHandle(process)
	if r == 0 {
		_ = syscall.CloseHandle(job)
		return g, fmt.Errorf("AssignProcessToJobObject: %w", err)
	}
	g.job, g.open = job, true
	return g, nil
}

// terminate has no graceful form on Windows; the shutdown message and the
// closed stdin are the graceful path.
func (g *procGroup) terminate() error { return nil }

// kill ends the worker and everything in its job; without a job (setup
// failed) it ends the worker alone.
func (g *procGroup) kill() error {
	if g == nil {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.open {
		r, _, err := procTerminateJobObject.Call(uintptr(g.job), 1)
		if r == 0 {
			return fmt.Errorf("TerminateJobObject: %w", err)
		}
		return nil
	}
	if g.cmd != nil && g.cmd.Process != nil {
		_ = g.cmd.Process.Kill()
	}
	return nil
}

// release closes the job handle, which also kills anything still in it.
func (g *procGroup) release() {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.open {
		_ = syscall.CloseHandle(g.job)
		g.open = false
	}
}

// awaitExit waits up to d for the worker process to exit.
func (g *procGroup) awaitExit(pid int, d time.Duration) {
	h, err := syscall.OpenProcess(synchronize, false, uint32(pid))
	if err != nil {
		return
	}
	defer syscall.CloseHandle(h)
	_, _ = syscall.WaitForSingleObject(h, uint32(d/time.Millisecond))
}

// processExited reports whether pid has exited.
func processExited(pid int) bool {
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return true
	}
	defer syscall.CloseHandle(h)
	var code uint32
	if err := syscall.GetExitCodeProcess(h, &code); err != nil {
		return true
	}
	return code != stillActive
}

const canTerminate = false
