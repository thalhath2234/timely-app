package agent

import (
	"context"
	"time"
)

type timezoneKey struct{}

// WithTimezone records the person's effective timezone for in-app chat runs
// (saved Working hours, else the device zone, else UTC). Tools use it whenever
// the model omits a timezone, so dates never fall back to the server's zone.
// Hermes requests carry no value: their dates fall back to the server's zone
// (see location), while Work status follows task.DayLocation and so uses the
// saved Working hours, else UTC, exactly as Auto-schedule does.
func WithTimezone(ctx context.Context, name string) context.Context {
	return context.WithValue(ctx, timezoneKey{}, name)
}

// TimezoneFrom returns the zone set by WithTimezone, or "".
func TimezoneFrom(ctx context.Context) string {
	name, _ := ctx.Value(timezoneKey{}).(string)
	return name
}

// zone prefers an explicit tool argument, then the chat run's timezone.
func zone(ctx context.Context, explicit string) string {
	if explicit != "" {
		return explicit
	}
	return TimezoneFrom(ctx)
}

// location resolves zone() and falls back to the server's zone for Hermes.
func location(ctx context.Context, explicit string) *time.Location {
	if name := zone(ctx, explicit); name != "" {
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
	}
	return time.Local
}
