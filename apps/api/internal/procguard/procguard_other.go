//go:build !linux

package procguard

// Elsewhere there is no /proc/<pid>/environ for a same-uid process to read.
func setNotDumpable() (bool, error) { return false, nil }
