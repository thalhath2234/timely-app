//go:build windows

package agenthost

import (
	"testing"
	"unsafe"
)

// The Job Object structs must match the C layout, or SetInformationJobObject
// fails with ERROR_BAD_LENGTH and stops fall back to killing the worker alone.
func TestJobObjectStructSizes(t *testing.T) {
	ioOffset, extended := uintptr(64), uintptr(144)
	if unsafe.Sizeof(uintptr(0)) == 4 {
		ioOffset, extended = 48, 112
	}
	if got := unsafe.Offsetof(jobExtendedLimitInformation{}.IoInfo); got != ioOffset {
		t.Errorf("IoInfo at offset %d, want %d", got, ioOffset)
	}
	if got := unsafe.Sizeof(jobExtendedLimitInformation{}); got != extended {
		t.Errorf("JOBOBJECT_EXTENDED_LIMIT_INFORMATION is %d bytes, want %d", got, extended)
	}
}
