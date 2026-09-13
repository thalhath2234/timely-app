// Package recurrence implements the subset of RFC 5545 RRULE the product needs:
// FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, COUNT, UNTIL, BYDAY (with an
// optional ordinal for monthly rules such as 2TU or -1FR), BYMONTHDAY and
// BYMONTH. Occurrences are expanded on demand for a date range; nothing is
// persisted per instance.
package recurrence

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Freq string

const (
	Daily   Freq = "DAILY"
	Weekly  Freq = "WEEKLY"
	Monthly Freq = "MONTHLY"
	Yearly  Freq = "YEARLY"
)

// ByDay is a weekday with an optional ordinal (0 = every, 2 = second, -1 = last).
type ByDay struct {
	Weekday time.Weekday
	Ordinal int
}

type Rule struct {
	Freq       Freq
	Interval   int
	Count      int
	Until      *time.Time
	ByDay      []ByDay
	ByMonthDay []int
	ByMonth    []int
}

// Safety valve: a rule that keeps producing candidates without landing in the
// requested window stops after this many iterations.
const maxIterations = 20000

var weekdayCodes = map[string]time.Weekday{
	"SU": time.Sunday, "MO": time.Monday, "TU": time.Tuesday, "WE": time.Wednesday,
	"TH": time.Thursday, "FR": time.Friday, "SA": time.Saturday,
}

var weekdayNames = map[time.Weekday]string{
	time.Sunday: "SU", time.Monday: "MO", time.Tuesday: "TU", time.Wednesday: "WE",
	time.Thursday: "TH", time.Friday: "FR", time.Saturday: "SA",
}

// Parse reads an RRULE string. A leading "RRULE:" prefix is tolerated.
func Parse(input string) (*Rule, error) {
	text := strings.TrimSpace(input)
	text = strings.TrimPrefix(text, "RRULE:")
	if text == "" {
		return nil, errors.New("rrule cannot be empty")
	}

	rule := &Rule{Interval: 1}
	for _, part := range strings.Split(text, ";") {
		if part == "" {
			continue
		}
		key, value, found := strings.Cut(part, "=")
		if !found {
			return nil, fmt.Errorf("invalid rrule part %q", part)
		}
		key = strings.ToUpper(strings.TrimSpace(key))
		value = strings.TrimSpace(value)

		switch key {
		case "FREQ":
			switch Freq(strings.ToUpper(value)) {
			case Daily, Weekly, Monthly, Yearly:
				rule.Freq = Freq(strings.ToUpper(value))
			default:
				return nil, fmt.Errorf("unsupported FREQ %q", value)
			}
		case "INTERVAL":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > 1000 {
				return nil, fmt.Errorf("invalid INTERVAL %q", value)
			}
			rule.Interval = n
		case "COUNT":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 {
				return nil, fmt.Errorf("invalid COUNT %q", value)
			}
			rule.Count = n
		case "UNTIL":
			until, err := parseUntil(value)
			if err != nil {
				return nil, err
			}
			rule.Until = &until
		case "BYDAY":
			for _, item := range strings.Split(value, ",") {
				day, err := parseByDay(strings.TrimSpace(item))
				if err != nil {
					return nil, err
				}
				rule.ByDay = append(rule.ByDay, day)
			}
		case "BYMONTHDAY":
			for _, item := range strings.Split(value, ",") {
				n, err := strconv.Atoi(strings.TrimSpace(item))
				if err != nil || n == 0 || n < -31 || n > 31 {
					return nil, fmt.Errorf("invalid BYMONTHDAY %q", item)
				}
				rule.ByMonthDay = append(rule.ByMonthDay, n)
			}
		case "BYMONTH":
			for _, item := range strings.Split(value, ",") {
				n, err := strconv.Atoi(strings.TrimSpace(item))
				if err != nil || n < 1 || n > 12 {
					return nil, fmt.Errorf("invalid BYMONTH %q", item)
				}
				rule.ByMonth = append(rule.ByMonth, n)
			}
		case "WKST":
			// Week start only affects multi-week BYWEEKNO rules, which are not
			// supported; accepted so exported rules round-trip.
		default:
			return nil, fmt.Errorf("unsupported rrule part %q", key)
		}
	}

	if rule.Freq == "" {
		return nil, errors.New("rrule requires FREQ")
	}
	if rule.Count > 0 && rule.Until != nil {
		return nil, errors.New("rrule cannot have both COUNT and UNTIL")
	}
	for _, day := range rule.ByDay {
		if day.Ordinal != 0 && rule.Freq != Monthly && rule.Freq != Yearly {
			return nil, errors.New("BYDAY ordinals are only valid for MONTHLY or YEARLY rules")
		}
	}
	return rule, nil
}

func parseUntil(value string) (time.Time, error) {
	for _, layout := range []string{"20060102T150405Z", "20060102T150405", "20060102", time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid UNTIL %q", value)
}

func parseByDay(value string) (ByDay, error) {
	if len(value) < 2 {
		return ByDay{}, fmt.Errorf("invalid BYDAY %q", value)
	}
	code := strings.ToUpper(value[len(value)-2:])
	weekday, ok := weekdayCodes[code]
	if !ok {
		return ByDay{}, fmt.Errorf("invalid BYDAY %q", value)
	}
	ordinal := 0
	if prefix := value[:len(value)-2]; prefix != "" {
		n, err := strconv.Atoi(prefix)
		if err != nil || n == 0 || n < -5 || n > 5 {
			return ByDay{}, fmt.Errorf("invalid BYDAY ordinal %q", value)
		}
		ordinal = n
	}
	return ByDay{Weekday: weekday, Ordinal: ordinal}, nil
}

// String serialises the rule back to RFC 5545 form.
func (r *Rule) String() string {
	parts := []string{"FREQ=" + string(r.Freq)}
	if r.Interval > 1 {
		parts = append(parts, "INTERVAL="+strconv.Itoa(r.Interval))
	}
	if r.Count > 0 {
		parts = append(parts, "COUNT="+strconv.Itoa(r.Count))
	}
	if r.Until != nil {
		parts = append(parts, "UNTIL="+r.Until.UTC().Format("20060102T150405Z"))
	}
	if len(r.ByDay) > 0 {
		days := make([]string, 0, len(r.ByDay))
		for _, day := range r.ByDay {
			if day.Ordinal != 0 {
				days = append(days, strconv.Itoa(day.Ordinal)+weekdayNames[day.Weekday])
			} else {
				days = append(days, weekdayNames[day.Weekday])
			}
		}
		parts = append(parts, "BYDAY="+strings.Join(days, ","))
	}
	if len(r.ByMonthDay) > 0 {
		parts = append(parts, "BYMONTHDAY="+joinInts(r.ByMonthDay))
	}
	if len(r.ByMonth) > 0 {
		parts = append(parts, "BYMONTH="+joinInts(r.ByMonth))
	}
	return strings.Join(parts, ";")
}

func joinInts(values []int) string {
	items := make([]string, len(values))
	for i, v := range values {
		items[i] = strconv.Itoa(v)
	}
	return strings.Join(items, ",")
}

// WithUntil returns a copy of the rule that stops before `cutoff`. It is used
// to close a series when the user edits "this and future" occurrences.
func (r *Rule) WithUntil(cutoff time.Time) *Rule {
	clone := *r
	until := cutoff.Add(-time.Second).UTC()
	clone.Until = &until
	clone.Count = 0
	return &clone
}

// Between expands the rule anchored at dtstart and returns every occurrence
// start in [from, to). COUNT is counted from dtstart, so occurrences before
// `from` still consume it. dtstart's location decides the local clock the
// pattern is evaluated in, which keeps a 07:00 run at 07:00 across DST.
func (r *Rule) Between(dtstart, from, to time.Time) []time.Time {
	if !to.After(from) {
		return nil
	}
	loc := dtstart.Location()
	var out []time.Time
	produced := 0

	emit := func(candidate time.Time) (stop bool) {
		if candidate.Before(dtstart) {
			return false
		}
		if r.Until != nil && candidate.After(*r.Until) {
			return true
		}
		if r.Count > 0 && produced >= r.Count {
			return true
		}
		produced++
		if !candidate.Before(to) {
			return true
		}
		if !candidate.Before(from) {
			out = append(out, candidate)
		}
		return false
	}

	switch r.Freq {
	case Daily:
		r.expandDaily(dtstart, loc, emit)
	case Weekly:
		r.expandWeekly(dtstart, loc, emit)
	case Monthly:
		r.expandMonthly(dtstart, loc, emit)
	case Yearly:
		r.expandYearly(dtstart, loc, emit)
	}
	return out
}

// Next returns the first occurrence at or after `at`, or nil.
func (r *Rule) Next(dtstart, at time.Time) *time.Time {
	horizon := at.AddDate(10, 0, 0)
	if r.Until != nil && r.Until.Before(horizon) {
		horizon = r.Until.Add(time.Second)
	}
	found := r.Between(dtstart, at, horizon)
	if len(found) == 0 {
		return nil
	}
	return &found[0]
}

func atClock(day time.Time, reference time.Time, loc *time.Location) time.Time {
	return time.Date(day.Year(), day.Month(), day.Day(),
		reference.Hour(), reference.Minute(), reference.Second(), 0, loc)
}

func (r *Rule) expandDaily(dtstart time.Time, loc *time.Location, emit func(time.Time) bool) {
	start := dtstart.In(loc)
	for i := 0; i < maxIterations; i++ {
		day := start.AddDate(0, 0, i*r.Interval)
		candidate := atClock(day, start, loc)
		if !r.matchesMonth(candidate) {
			continue
		}
		if emit(candidate) {
			return
		}
	}
}

func (r *Rule) expandWeekly(dtstart time.Time, loc *time.Location, emit func(time.Time) bool) {
	start := dtstart.In(loc)
	days := r.weekdaysOrDefault(start.Weekday())

	// Weeks start on Monday (RFC default WKST=MO).
	offset := (int(start.Weekday()) + 6) % 7
	weekStart := start.AddDate(0, 0, -offset)

	for week := 0; week < maxIterations; week++ {
		base := weekStart.AddDate(0, 0, week*7*r.Interval)
		for _, weekday := range days {
			dayOffset := (int(weekday) + 6) % 7
			day := base.AddDate(0, 0, dayOffset)
			candidate := atClock(day, start, loc)
			if !r.matchesMonth(candidate) {
				continue
			}
			if emit(candidate) {
				return
			}
		}
	}
}

func (r *Rule) weekdaysOrDefault(fallback time.Weekday) []time.Weekday {
	if len(r.ByDay) == 0 {
		return []time.Weekday{fallback}
	}
	seen := map[time.Weekday]bool{}
	var days []time.Weekday
	for _, day := range r.ByDay {
		if !seen[day.Weekday] {
			seen[day.Weekday] = true
			days = append(days, day.Weekday)
		}
	}
	sort.Slice(days, func(i, j int) bool {
		return (int(days[i])+6)%7 < (int(days[j])+6)%7
	})
	return days
}

func (r *Rule) expandMonthly(dtstart time.Time, loc *time.Location, emit func(time.Time) bool) {
	start := dtstart.In(loc)
	firstOfMonth := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, loc)

	for i := 0; i < maxIterations; i++ {
		month := firstOfMonth.AddDate(0, i*r.Interval, 0)
		if !r.matchesMonth(month) {
			continue
		}
		for _, day := range r.daysInMonth(month, start.Day(), loc) {
			candidate := atClock(day, start, loc)
			if emit(candidate) {
				return
			}
		}
	}
}

func (r *Rule) expandYearly(dtstart time.Time, loc *time.Location, emit func(time.Time) bool) {
	start := dtstart.In(loc)
	months := r.ByMonth
	if len(months) == 0 {
		months = []int{int(start.Month())}
	}
	sort.Ints(months)

	for i := 0; i < maxIterations; i++ {
		year := start.Year() + i*r.Interval
		for _, monthNumber := range months {
			month := time.Date(year, time.Month(monthNumber), 1, 0, 0, 0, 0, loc)
			for _, day := range r.daysInMonth(month, start.Day(), loc) {
				candidate := atClock(day, start, loc)
				if emit(candidate) {
					return
				}
			}
		}
	}
}

// daysInMonth lists the dates inside `month` selected by BYMONTHDAY / BYDAY,
// falling back to the dtstart day-of-month. Days that do not exist (Feb 30)
// are skipped rather than rolled over.
func (r *Rule) daysInMonth(month time.Time, defaultDay int, loc *time.Location) []time.Time {
	lastDay := month.AddDate(0, 1, -1).Day()
	var days []time.Time

	if len(r.ByDay) > 0 {
		for _, spec := range r.ByDay {
			days = append(days, weekdaysInMonth(month, spec, lastDay, loc)...)
		}
	} else {
		monthDays := r.ByMonthDay
		if len(monthDays) == 0 {
			monthDays = []int{defaultDay}
		}
		for _, dayNumber := range monthDays {
			resolved := dayNumber
			if dayNumber < 0 {
				resolved = lastDay + dayNumber + 1
			}
			if resolved < 1 || resolved > lastDay {
				continue
			}
			days = append(days, time.Date(month.Year(), month.Month(), resolved, 0, 0, 0, 0, loc))
		}
	}

	sort.Slice(days, func(i, j int) bool { return days[i].Before(days[j]) })
	return dedupeDays(days)
}

func weekdaysInMonth(month time.Time, spec ByDay, lastDay int, loc *time.Location) []time.Time {
	var matches []time.Time
	for day := 1; day <= lastDay; day++ {
		date := time.Date(month.Year(), month.Month(), day, 0, 0, 0, 0, loc)
		if date.Weekday() == spec.Weekday {
			matches = append(matches, date)
		}
	}
	switch {
	case spec.Ordinal == 0:
		return matches
	case spec.Ordinal > 0:
		if spec.Ordinal <= len(matches) {
			return matches[spec.Ordinal-1 : spec.Ordinal]
		}
	default:
		index := len(matches) + spec.Ordinal
		if index >= 0 {
			return matches[index : index+1]
		}
	}
	return nil
}

func dedupeDays(days []time.Time) []time.Time {
	var out []time.Time
	for _, day := range days {
		if len(out) == 0 || !out[len(out)-1].Equal(day) {
			out = append(out, day)
		}
	}
	return out
}

func (r *Rule) matchesMonth(t time.Time) bool {
	if len(r.ByMonth) == 0 {
		return true
	}
	for _, month := range r.ByMonth {
		if int(t.Month()) == month {
			return true
		}
	}
	return false
}
