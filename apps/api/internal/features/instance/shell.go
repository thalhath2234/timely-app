package instance

import (
	"crypto/sha256"
	"crypto/subtle"
	"net"
	"net/http"
	"net/netip"
	"os"
	"sync/atomic"

	"github.com/labstack/echo/v5"
)

// ShellTokenEnv carries the desktop app's per-launch token (plan 11.4). The
// Electron supervisor makes it, passes it to the API and keeps it out of every
// page: the renderer asks the main process to send a request, and the main
// process adds the token. A request that carries it, from this computer, is
// "the desktop window" for the instance settings and the Full Access step-up.
const ShellTokenEnv = "TIMELY_SHELL_TOKEN"

// ShellTokenHeader is the request header the desktop main process sets.
const ShellTokenHeader = "X-Timely-Shell-Token"

// A token under this length is never accepted (the supervisor sends 64 hex
// characters); it guards against a mistyped or truncated variable.
const minShellTokenLen = 16

// shellDigest is the SHA-256 of the configured token; nil means none. The
// digest is what is compared, so the comparison is constant-time whatever
// length the caller sends.
var shellDigest atomic.Pointer[[sha256.Size]byte]

// SetShellToken sets (or, with "", clears) the token the API accepts.
func SetShellToken(token string) {
	if len(token) < minShellTokenLen {
		shellDigest.Store(nil)
		return
	}
	sum := sha256.Sum256([]byte(token))
	shellDigest.Store(&sum)
}

// ShellTokenFromEnv reads TIMELY_SHELL_TOKEN into SetShellToken and removes
// it from the process environment, so no child process (a CLI provider, an
// agent worker, a shell the agent starts) inherits it.
func ShellTokenFromEnv() {
	SetShellToken(os.Getenv(ShellTokenEnv))
	_ = os.Unsetenv(ShellTokenEnv)
}

// ShellRequest reports whether this request came from the desktop window: it
// carries the shell token (constant-time match) and its TCP peer is a
// loopback address. It is never true when no token is configured, and a
// request that passed through a proxy (X-Forwarded-For, Forwarded, X-Real-Ip)
// is never the desktop window, whatever it carries. The peer is the socket's
// address, not the client address Echo derives from forwarding headers.
func ShellRequest(c *echo.Context) bool {
	return shellRequest(c.Request(), shellDigest.Load())
}

func shellRequest(r *http.Request, digest *[sha256.Size]byte) bool {
	if digest == nil {
		return false
	}
	got := r.Header.Get(ShellTokenHeader)
	if got == "" {
		return false
	}
	sum := sha256.Sum256([]byte(got))
	tokenOK := subtle.ConstantTimeCompare(sum[:], digest[:]) == 1
	// Every check runs, so the answer does not reveal which one failed.
	loopbackOK := loopbackPeer(r)
	proxied := r.Header.Get("X-Forwarded-For") != "" || r.Header.Get("Forwarded") != "" || r.Header.Get("X-Real-Ip") != ""
	return tokenOK && loopbackOK && !proxied
}

func loopbackPeer(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	addr, err := netip.ParseAddr(host)
	return err == nil && addr.Unmap().IsLoopback()
}

// ShellOnly answers 404 to every request that is not the desktop window, so
// the route does not exist for anyone else (not 401: a session cannot find
// it by trying).
func ShellOnly(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c *echo.Context) error {
		if !ShellRequest(c) {
			return echo.ErrNotFound
		}
		return next(c)
	}
}
