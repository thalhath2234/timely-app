// Package buildinfo exposes the binary's version and start time to features
// that report them (GET /health, GET /instance). main sets Version from the
// -ldflags "-X main.version=..." value at startup.
package buildinfo

import "time"

// Version is the release the binary was built from; "dev" when unset.
var Version = "dev"

// StartedAt is when the process began serving.
var StartedAt = time.Now().UTC()

// Set records the version and start time once, at process start.
func Set(version string) {
	if version != "" {
		Version = version
	}
	StartedAt = time.Now().UTC()
}

// UptimeSeconds is the whole seconds since StartedAt.
func UptimeSeconds() int64 {
	return int64(time.Since(StartedAt).Seconds())
}
