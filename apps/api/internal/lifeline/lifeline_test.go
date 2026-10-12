package lifeline

import (
	"io"
	"testing"
	"time"
)

func TestEnabled(t *testing.T) {
	cases := map[string]bool{"stdin": true, " stdin ": true, "": false, "1": false, "pipe": false}
	for value, want := range cases {
		got := Enabled(func(string) string { return value })
		if got != want {
			t.Errorf("Enabled(%q) = %v, want %v", value, got, want)
		}
	}
}

func TestWatchClosesWhenTheWriterGoes(t *testing.T) {
	r, w := io.Pipe()
	gone := Watch(r)
	select {
	case <-gone:
		t.Fatal("closed while the writer is still open")
	case <-time.After(50 * time.Millisecond):
	}
	// Bytes on the pipe are not a signal; only EOF is.
	if _, err := w.Write([]byte("ignored")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gone:
		t.Fatal("closed after a write")
	case <-time.After(50 * time.Millisecond):
	}
	_ = w.Close()
	select {
	case <-gone:
	case <-time.After(time.Second):
		t.Fatal("did not close after EOF")
	}
}

func TestWatchClosesOnReadError(t *testing.T) {
	r, w := io.Pipe()
	gone := Watch(r)
	_ = w.CloseWithError(io.ErrUnexpectedEOF)
	select {
	case <-gone:
	case <-time.After(time.Second):
		t.Fatal("did not close after a read error")
	}
}

func TestFromEnvOffByDefault(t *testing.T) {
	t.Setenv(EnvVar, "")
	if FromEnv() != nil {
		t.Fatal("FromEnv watched stdin without TIMELY_LIFELINE=stdin")
	}
}
