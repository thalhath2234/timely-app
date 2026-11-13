//go:build linux

package procguard

import "syscall"

func setNotDumpable() (bool, error) {
	if _, _, errno := syscall.RawSyscall(syscall.SYS_PRCTL, syscall.PR_SET_DUMPABLE, 0, 0); errno != 0 {
		return false, errno
	}
	return true, nil
}
