package task

import (
	"time"
	"timely-api/internal/models"
)

// Today is the current date in the person's Working hours timezone. Work
// status (Overdue, Unscheduled, Missed) is always judged against a Today, so
// the zone is chosen once, at construction. Build one with TodayFor, or with
// TodayAt when a caller deliberately uses another zone; the zero Today is not
// meaningful.
type Today struct {
	now time.Time // an instant, expressed in the day-boundary location
}

// TodayAt is the date of the instant now in loc. Use it directly only when a
// zone other than the Working hours timezone is deliberate (documented at the
// call site); otherwise use TodayFor.
func TodayAt(now time.Time, loc *time.Location) Today {
	if loc == nil {
		loc = time.UTC
	}
	return Today{now: now.In(loc)}
}

// TodayFor is the current date in the Working hours timezone of hours; with no
// saved timezone the client's zone applies, then the server's zone (see
// DayLocation).
func TodayFor(hours models.WorkingHours, clientTimezone string, now time.Time) Today {
	return TodayAt(now, DayLocation(hours, clientTimezone))
}

// DayLocation is the single day-boundary location shared by Auto-schedule,
// free-time, and Work status: saved Working hours win, then the client's
// timezone, then the server's zone. The desktop app hosts the backend (ADR
// 0011), so the server's zone is the person's own, not an arbitrary default.
// One resolver keeps "today" identical between placing Work and listing what is
// still Unscheduled for a new account without saved hours.
func DayLocation(hours models.WorkingHours, clientTimezone string) *time.Location {
	loc := time.Local
	if clientTimezone != "" {
		if parsed, err := time.LoadLocation(clientTimezone); err == nil {
			loc = parsed
		}
	}
	return hours.Location(loc)
}

// Now is the instant the status was taken at, in the day-boundary location.
func (d Today) Now() time.Time { return d.now }

// Location is the day-boundary location.
func (d Today) Location() *time.Location { return d.now.Location() }

// Date is the calendar date as YYYY-MM-DD.
func (d Today) Date() string { return d.now.Format("2006-01-02") }

// Start is midnight at the beginning of the date.
func (d Today) Start() time.Time {
	return time.Date(d.now.Year(), d.now.Month(), d.now.Day(), 0, 0, 0, 0, d.Location())
}
