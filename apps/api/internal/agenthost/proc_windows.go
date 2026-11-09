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
// The worker starts suspended (CREATE_SUSPENDED), is assigned to the job, and
// only then resumed (NtResumeProcess). The spawned program is usually the
// venv's Scripts\python.exe, a launcher that starts the real interpreter as
// its own child at once (hermes_cli/update_custody.py documents this); were
// the launcher assigned after it ran, that child would already be outside the
// job. Started suspended, everything it creates inherits the job (nested jobs,
// Windows 8+). ready carries the interpreter's own pid and the handshake checks
// it is in the job (IsProcessInJob).

const (
	createSuspended       = 0x00000004
	createNewProcessGroup = 0x00000200
	createNoWindow        = 0x08000000

	processSetQuota                = 0x0100
	processTerminate               = 0x0001
	processSuspendResume           = 0x0800
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
	procIsProcessInJob           = kernel32.NewProc("IsProcessInJob")
	ntdll                        = syscall.NewLazyDLL("ntdll.dll")
	procNtResumeProcess          = ntdll.NewProc("NtResumeProcess")
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

// configureWorkerCmd is configureCmd plus CREATE_SUSPENDED: startGroup
// resumes the worker once it is in its job.
func configureWorkerCmd(cmd *exec.Cmd) {
	configureCmd(cmd)
	cmd.SysProcAttr.CreationFlags |= createSuspended
}

type procGroup struct {
	cmd    *exec.Cmd
	mu     sync.Mutex
	job    syscall.Handle
	open   bool
	reaped bool
}

// startGroup puts the suspended worker into a new Job Object and resumes it.
// A worker it cannot put in the job is terminated while still suspended (it
// never runs, so it cannot start a child outside the job); a worker it cannot
// resume is killed. A failure never leaves a worker frozen or running.
func startGroup(cmd *exec.Cmd) (*procGroup, error) {
	g := &procGroup{cmd: cmd}
	process, err := syscall.OpenProcess(processSetQuota|processTerminate|processSuspendResume, false, uint32(cmd.Process.Pid))
	if err != nil {
		_ = cmd.Process.Kill() // suspended and unreachable: it could never run
		return g, fmt.Errorf("OpenProcess: %w (worker killed)", err)
	}
	defer syscall.CloseHandle(process)
	if err := g.assign(process); err != nil {
		// Never resume a worker outside its job: the venv's python.exe launcher starts the real
		// interpreter as soon as it runs, and that child would escape both the job and the kill.
		_ = syscall.TerminateProcess(process, 1)
		_ = cmd.Process.Kill()
		return g, fmt.Errorf("%w (worker killed while suspended)", err)
	}
	if r, _, err := procNtResumeProcess.Call(uintptr(process)); r != 0 {
		_ = cmd.Process.Kill()
		return g, fmt.Errorf("NtResumeProcess: status %#x %v (worker killed)", r, err)
	}
	return g, nil
}

func (g *procGroup) assign(process syscall.Handle) error {
	r, _, err := procCreateJobObjectW.Call(0, 0)
	if r == 0 {
		return fmt.Errorf("CreateJobObject: %w", err)
	}
	job := syscall.Handle(r)
	var info jobExtendedLimitInformation
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	r, _, err = procSetInformationJobObject.Call(uintptr(job), jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))
	if r == 0 {
		_ = syscall.CloseHandle(job)
		return fmt.Errorf("SetInformationJobObject: %w", err)
	}
	r, _, err = procAssignProcessToJobObject.Call(uintptr(job), uintptr(process))
	if r == 0 {
		_ = syscall.CloseHandle(job)
		return fmt.Errorf("AssignProcessToJobObject: %w", err)
	}
	g.job, g.open = job, true
	return nil
}

// contains reports whether pid is inside the worker's Job Object.
func (g *procGroup) contains(pid int) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.open {
		return false, fmt.Errorf("no Job Object")
	}
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return false, err
	}
	defer syscall.CloseHandle(h)
	var in int32
	if r, _, err := procIsProcessInJob.Call(uintptr(h), uintptr(g.job), uintptr(unsafe.Pointer(&in))); r == 0 {
		return false, fmt.Errorf("IsProcessInJob: %w", err)
	}
	return in != 0, nil
}

// markReaped is called right before the worker is reaped; later kills skip
// the bare-process fallback (the job, while open, is still safe to end).
func (g *procGroup) markReaped() {
	if g == nil {
		return
	}
	g.mu.Lock()
	g.reaped = true
	g.mu.Unlock()
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
	if !g.reaped && g.cmd != nil && g.cmd.Process != nil {
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
