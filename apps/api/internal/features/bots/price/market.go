package price

import "time"

// nextOpen is the first session start after now: start moved on a day at a
// time (on the exchange's wall clock, so a DST change keeps the hour),
// skipping weekends. Holidays are not known; a check on one finds the market
// still closed and waits again.
func nextOpen(start, now time.Time, loc *time.Location) time.Time {
	t := start.In(loc)
	for range 400 {
		if t.After(now) && t.Weekday() != time.Saturday && t.Weekday() != time.Sunday {
			return t.UTC()
		}
		t = t.AddDate(0, 0, 1)
	}
	return time.Time{}
}

// usSession says whether the US regular session (09:30-16:00 New York,
// Monday to Friday) is open at now, and when it next opens if not.
func usSession(now time.Time) (open bool, next time.Time) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		return true, time.Time{} // no zone data: never hold a check back
	}
	d := now.In(loc)
	start := time.Date(d.Year(), d.Month(), d.Day(), 9, 30, 0, 0, loc)
	end := time.Date(d.Year(), d.Month(), d.Day(), 16, 0, 0, 0, loc)
	weekday := d.Weekday() != time.Saturday && d.Weekday() != time.Sunday
	if weekday && !now.Before(start) && now.Before(end) {
		return true, time.Time{}
	}
	return false, nextOpen(start, now, loc)
}
