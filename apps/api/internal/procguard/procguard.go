// Package procguard keeps the API's environment out of reach of the processes
// it starts. Agent workers, and the terminal commands an approved run starts,
// run as the same uid as the API (uid 10001 in the Docker image). Their
// environment is built from scratch (agenthost BuildEnv), but on Linux any
// same-uid process could still read the API's own /proc/<pid>/environ, which
// holds JWT_SECRET, DB_PASSWORD and every key docker compose loads from the
// shared .env. Harden marks the API non-dumpable, which makes its /proc files
// root-owned. The children it starts are dumpable again after exec, so this
// limits nothing of theirs.
package procguard

import "timely-api/internal/lifeline"

// Harden makes this process non-dumpable on Linux and reports whether it did.
// It leaves a desktop sidecar (lifeline on) alone: the desktop app finds a
// leftover API from an earlier run by reading its /proc/<pid>/environ
// (electron/supervisor/lifetime.ts findOrphans), and on the desktop the
// workers run as the person who owns the whole app anyway.
func Harden(getenv func(string) string) (bool, error) {
	if lifeline.Enabled(getenv) {
		return false, nil
	}
	return setNotDumpable()
}
