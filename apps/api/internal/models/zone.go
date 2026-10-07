package models

import (
	"os"
	"strings"
	"time"
)

// ZoneName is the name of loc for anything stored or returned: a payload, a
// response, default Working hours. The server's own zone (time.Local) is
// called "Local" by Go, which a client or a later LoadLocation cannot resolve,
// so it is "" ("no zone named: the server's"). Read "" back as the server's
// zone, never as UTC.
func ZoneName(loc *time.Location) string {
	if loc == nil || loc == time.Local {
		return ""
	}
	return loc.String()
}

// ClientZoneName is ZoneName for a response a client will read: the server's
// zone is reported by its IANA name when that can be found, else "".
func ClientZoneName(loc *time.Location) string {
	if name := ZoneName(loc); name != "" || loc != nil && loc != time.Local {
		return name
	}
	return ServerZoneName()
}

// ServerZoneName is the IANA name of the server's zone from the TZ variable or
// the /etc/localtime link, or "" when neither names one.
func ServerZoneName() string {
	if tz := strings.TrimPrefix(os.Getenv("TZ"), ":"); tz != "" && tz != "Local" {
		if _, err := time.LoadLocation(tz); err == nil {
			return tz
		}
	}
	target, err := os.Readlink("/etc/localtime")
	if err != nil {
		return ""
	}
	if i := strings.Index(target, "zoneinfo/"); i >= 0 {
		name := target[i+len("zoneinfo/"):]
		if _, err := time.LoadLocation(name); err == nil && name != "Local" {
			return name
		}
	}
	return ""
}
