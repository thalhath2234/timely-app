package fetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"syscall"
	"time"

	"timely-api/internal/netguard"
)

// The errors Get returns. A caller sorts them with errors.Is and errors.As;
// the texts are written for the person.
var (
	ErrOffline        = errors.New("offline")
	ErrCaptcha        = errors.New("the site showed a robot check")
	ErrForbidden      = errors.New("the site refused the request")
	ErrNotFound       = errors.New("the page is gone")
	ErrTooBig         = errors.New("the page is too large")
	ErrRobots         = errors.New("robots.txt asks automated tools not to read it")
	ErrUnsupported    = errors.New("not a page, feed or JSON")
	ErrBlockedAddress = errors.New("not a public web address")
	ErrNoSuchHost     = errors.New("no such site")
)

// RateLimitedError is a 429 or 503. RetryAfter is 0 when the site named no
// time (see ParseRetryAfter).
type RateLimitedError struct {
	Status     int
	RetryAfter time.Duration
}

func (e *RateLimitedError) Error() string {
	if e.RetryAfter > 0 {
		return fmt.Sprintf("the site asked to wait %s (status %d)", e.RetryAfter, e.Status)
	}
	return fmt.Sprintf("the site is busy (status %d)", e.Status)
}

// SiteBusyError comes from a Spacer: the site's next free slot is further
// away than the caller is willing to wait.
type SiteBusyError struct{ Until time.Time }

func (e *SiteBusyError) Error() string {
	return "another check is reading this site until " + e.Until.UTC().Format(time.RFC3339)
}

// StatusError is any other answer of 400 or above, or a redirect that could
// not be followed (its 3xx status).
type StatusError struct{ Status int }

func (e *StatusError) Error() string {
	return fmt.Sprintf("the site answered with status %d", e.Status)
}

// transportError sorts an error from the client or a body read. ctx's own
// cancellation comes back as it is, so a caller can tell a shutdown apart.
func transportError(ctx context.Context, err error) error {
	switch {
	case errors.Is(err, netguard.ErrBlocked):
		return ErrBlockedAddress
	case errors.Is(err, context.Canceled) && ctx.Err() != nil:
		return ctx.Err()
	case offline(err):
		return fmt.Errorf("%w: %v", ErrOffline, err)
	case noSuchHost(err):
		return fmt.Errorf("%w: %v", ErrNoSuchHost, err)
	}
	return err
}

// noSuchHost is a name the resolver answered for and said does not exist,
// such as a typo. It is the site's fault, not the network's, so it is a
// strike; a resolver that couldn't answer stays offline.
func noSuchHost(err error) bool {
	var dnsErr *net.DNSError
	return errors.As(err, &dnsErr) && dnsErr.IsNotFound && !dnsErr.IsTemporary && !dnsErr.IsTimeout
}

// offline matches the transient test in chat.RetryTransient, plus the
// errors a machine with no network gives.
func offline(err error) bool {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) && (dnsErr.IsTemporary || dnsErr.IsTimeout) {
		return true
	}
	for _, target := range []error{
		syscall.ECONNREFUSED, syscall.ECONNRESET, syscall.ENETUNREACH, syscall.EHOSTUNREACH,
		io.ErrUnexpectedEOF, io.EOF, context.DeadlineExceeded,
	} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}
