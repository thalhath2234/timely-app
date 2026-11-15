package bots

import (
	"errors"
	"strings"
	"testing"
)

func TestCheckNoteEntryCaps(t *testing.T) {
	ok := []struct{ key, value string }{
		{"last_price", "89999"},
		{"k", ""},
		{strings.Repeat("k", MaxNoteKeyChars), "v"},
		{strings.Repeat("é", MaxNoteKeyChars), "v"}, // 128 characters, 256 bytes
		{"k", strings.Repeat("v", MaxNoteValueBytes)},
		{"seen urls", "line one\nline two\n"},
	}
	for _, c := range ok {
		if err := checkNoteEntry(c.key, c.value); err != nil {
			t.Errorf("key %d chars, value %d bytes: %v", len([]rune(c.key)), len(c.value), err)
		}
	}
	bad := []struct {
		name       string
		key, value string
		want       error
	}{
		{"empty key", "", "v", ErrNoteKey},
		{"key too long", strings.Repeat("k", MaxNoteKeyChars+1), "v", ErrNoteKey},
		{"key too long in characters", strings.Repeat("é", MaxNoteKeyChars+1), "v", ErrNoteKey},
		{"control character in key", "a\nb", "v", ErrNoteKey},
		{"value too large", "k", strings.Repeat("v", MaxNoteValueBytes+1), ErrNoteValue},
		{"value too large in bytes", "k", strings.Repeat("é", MaxNoteValueBytes/2+1), ErrNoteValue},
	}
	for _, c := range bad {
		if err := checkNoteEntry(c.key, c.value); !errors.Is(err, c.want) && err != c.want {
			t.Errorf("%s: got %v, want %v", c.name, err, c.want)
		}
	}
	if err := checkNoteEntry("k", "a\x00b"); err == nil {
		t.Error("a NUL in a value was accepted")
	}
	if err := checkNoteEntry("k", "\xff\xfe"); err == nil {
		t.Error("invalid UTF-8 in a value was accepted")
	}
}

// The messages say what to do.
func TestNoteErrorsAreClear(t *testing.T) {
	for _, err := range []error{ErrNoteKey, ErrNoteValue, ErrNotepadFull} {
		var ie *InputError
		if !errors.As(err, &ie) || ie.Message == "" {
			t.Errorf("%v is not an InputError with a message", err)
		}
	}
	if !strings.Contains(ErrNotepadFull.Error(), "64 KB") || !strings.Contains(ErrNotepadFull.Error(), "Delete") {
		t.Errorf("full message %q", ErrNotepadFull)
	}
	if !strings.Contains(ErrNoteValue.Error(), "16 KB") || !strings.Contains(ErrNoteKey.Error(), "128") {
		t.Errorf("%q / %q", ErrNoteValue, ErrNoteKey)
	}
}
