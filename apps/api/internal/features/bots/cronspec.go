package bots

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Schedule is when an agent Bot runs (contract BotSchedule): every
// EveryMinutes, or DailyAt on Weekdays, or on a five-field Cron
// expression. Exactly one shape is set. It is a small port of Hermes'
// parse_schedule (cron/jobs.py) with no one-shot form: a one-time time is a
// Reminder, not a Bot.
type Schedule struct {
	EveryMinutes int    `json:"everyMinutes,omitempty"`
	DailyAt      string `json:"dailyAt,omitempty"`
	// Weekdays are 0 = Sunday ... 6 = Saturday, sorted, without repeats.
	Weekdays []int  `json:"weekdays,omitempty"`
	Cron     string `json:"cron,omitempty"`
}

// The shapes a Schedule takes.
const (
	ScheduleEvery = "every"
	ScheduleDaily = "daily"
	ScheduleCron  = "cron"
)

// Kind is the Schedule's shape, "" for an empty one.
func (s Schedule) Kind() string {
	switch {
	case s.Cron != "":
		return ScheduleCron
	case s.DailyAt != "":
		return ScheduleDaily
	case s.EveryMinutes > 0:
		return ScheduleEvery
	}
	return ""
}

// Map is the Schedule as bots.schedule stores it: {everyMinutes},
// {dailyAt, weekdays} or {cron}; {} for an empty one.
func (s Schedule) Map() jsonMap[string, any] {
	switch s.Kind() {
	case ScheduleEvery:
		return jsonMap[string, any]{"everyMinutes": s.EveryMinutes}
	case ScheduleDaily:
		days := make([]any, len(s.Weekdays))
		for i, d := range s.Weekdays {
			days[i] = d
		}
		return jsonMap[string, any]{"dailyAt": s.DailyAt, "weekdays": days}
	case ScheduleCron:
		return jsonMap[string, any]{"cron": s.Cron}
	}
	return jsonMap[string, any]{}
}

// ScheduleFromMap reads a stored or sent schedule object. Numbers may be
// float64 (JSON) or int. A shape that is not exactly one of the three, or
// one that does not parse, is an error.
func ScheduleFromMap(m map[string]any) (Schedule, error) {
	var s Schedule
	shapes := 0
	if v, ok := m["everyMinutes"]; ok {
		n, ok := wholeNumber(v)
		if !ok || n < 1 {
			return Schedule{}, invalid("Give everyMinutes as a whole number of minutes")
		}
		s.EveryMinutes = n
		shapes++
	}
	if v, ok := m["dailyAt"]; ok {
		at, ok := v.(string)
		if !ok {
			return Schedule{}, invalid("Give dailyAt as a time like 09:00")
		}
		s.DailyAt = at
		if raw, has := m["weekdays"]; has {
			list, ok := raw.([]any)
			if !ok {
				return Schedule{}, invalid("Give weekdays as a list of days, 0 for Sunday to 6 for Saturday")
			}
			for _, d := range list {
				n, ok := wholeNumber(d)
				if !ok {
					return Schedule{}, invalid("Give weekdays as a list of days, 0 for Sunday to 6 for Saturday")
				}
				s.Weekdays = append(s.Weekdays, n)
			}
		}
		shapes++
	} else if _, has := m["weekdays"]; has {
		return Schedule{}, invalid("weekdays goes with dailyAt")
	}
	if v, ok := m["cron"]; ok {
		c, ok := v.(string)
		if !ok {
			return Schedule{}, invalid("Give cron as a five-field expression like 0 9 * * *")
		}
		s.Cron = c
		shapes++
	}
	for k := range m {
		if k != "everyMinutes" && k != "dailyAt" && k != "weekdays" && k != "cron" {
			return Schedule{}, invalid("A schedule has everyMinutes, dailyAt with weekdays, or cron; %q is none of them", clipKey(k))
		}
	}
	if shapes != 1 {
		return Schedule{}, invalid("Set one schedule: everyMinutes, dailyAt with weekdays, or cron")
	}
	return s.Normalize()
}

func clipKey(k string) string {
	if r := []rune(k); len(r) > 30 {
		return string(r[:30])
	}
	return k
}

func wholeNumber(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		if n == float64(int(n)) {
			return int(n), true
		}
	}
	return 0, false
}

// maxEveryMinutes is the longest interval a schedule may name: a week, what
// bots.interval_seconds allows.
const maxEveryMinutes = int(maxInterval / time.Minute)

// Normalize checks a Schedule and returns it in its stored form: a daily
// time as HH:MM, weekdays sorted without repeats (none means every day), a
// cron expression with single spaces.
func (s Schedule) Normalize() (Schedule, error) {
	switch s.Kind() {
	case ScheduleEvery:
		if s.DailyAt != "" || s.Cron != "" || len(s.Weekdays) > 0 {
			return Schedule{}, invalid("Set one schedule: everyMinutes, dailyAt with weekdays, or cron")
		}
		if s.EveryMinutes > maxEveryMinutes {
			return Schedule{}, invalid("Run at least once a week (%d minutes)", maxEveryMinutes)
		}
		return Schedule{EveryMinutes: s.EveryMinutes}, nil
	case ScheduleDaily:
		if s.Cron != "" || s.EveryMinutes != 0 {
			return Schedule{}, invalid("Set one schedule: everyMinutes, dailyAt with weekdays, or cron")
		}
		h, m, ok := clockTime(s.DailyAt)
		if !ok {
			return Schedule{}, invalid("Give the time as HH:MM, like 09:00")
		}
		days := make([]int, 0, 7)
		for _, d := range s.Weekdays {
			if d < 0 || d > 6 {
				return Schedule{}, invalid("Weekdays are 0 for Sunday to 6 for Saturday")
			}
			days = append(days, d)
		}
		slices.Sort(days)
		days = slices.Compact(days)
		if len(days) == 0 {
			days = []int{0, 1, 2, 3, 4, 5, 6}
		}
		return Schedule{DailyAt: fmt.Sprintf("%02d:%02d", h, m), Weekdays: days}, nil
	case ScheduleCron:
		if s.DailyAt != "" || s.EveryMinutes != 0 || len(s.Weekdays) > 0 {
			return Schedule{}, invalid("Set one schedule: everyMinutes, dailyAt with weekdays, or cron")
		}
		c, err := ParseCron(s.Cron)
		if err != nil {
			return Schedule{}, err
		}
		return Schedule{Cron: c.expr}, nil
	}
	return Schedule{}, invalid("Set one schedule: everyMinutes, dailyAt with weekdays, or cron")
}

// ErrOneShot is ParseSchedule's answer to a time that happens once.
var ErrOneShot = errors.New("a one-time time is a Reminder, not a Bot")

var (
	durationRe = regexp.MustCompile(`^(\d*)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$`)
	clockRe    = regexp.MustCompile(`^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$`)
	isoRe      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)
)

// parseDuration reads "30m", "2h", "1d", "90 minutes" or a bare unit
// ("hour" is one) as a number of minutes, like Hermes' parse_duration.
func parseDuration(raw string) (int, bool) {
	m := durationRe.FindStringSubmatch(strings.ToLower(strings.TrimSpace(raw)))
	if m == nil {
		return 0, false
	}
	n := 1
	if m[1] != "" {
		v, err := strconv.Atoi(m[1])
		if err != nil || v < 1 || v > 1_000_000 {
			return 0, false
		}
		n = v
	}
	switch m[2][0] {
	case 'h':
		n *= 60
	case 'd':
		n *= 1440
	}
	return n, true
}

// clockTime reads "09:00", "9:30" (24-hour) or "9am", "9:30 pm".
func clockTime(raw string) (h, m int, ok bool) {
	g := clockRe.FindStringSubmatch(strings.ToLower(strings.TrimSpace(raw)))
	if g == nil {
		return 0, 0, false
	}
	h, _ = strconv.Atoi(g[1])
	if g[2] != "" {
		m, _ = strconv.Atoi(g[2])
	}
	switch g[3] {
	case "am", "pm":
		if h < 1 || h > 12 {
			return 0, 0, false
		}
		h %= 12
		if g[3] == "pm" {
			h += 12
		}
	default:
		// "9" alone is not a time: ask for HH:MM or an am/pm.
		if g[2] == "" {
			return 0, 0, false
		}
	}
	if h > 23 || m > 59 {
		return 0, 0, false
	}
	return h, m, true
}

var weekdayWords = map[string]int{
	"sunday": 0, "sun": 0, "monday": 1, "mon": 1, "tuesday": 2, "tue": 2, "tues": 2,
	"wednesday": 3, "wed": 3, "weds": 3, "thursday": 4, "thu": 4, "thur": 4, "thurs": 4,
	"friday": 5, "fri": 5, "saturday": 6, "sat": 6,
}

var daySpecs = map[string][]int{
	"day": {0, 1, 2, 3, 4, 5, 6}, "daily": {0, 1, 2, 3, 4, 5, 6}, "everyday": {0, 1, 2, 3, 4, 5, 6},
	"weekday": {1, 2, 3, 4, 5}, "weekdays": {1, 2, 3, 4, 5}, "weekend": {0, 6}, "weekends": {0, 6},
}

// naturalSchedule reads "monday 9am", "weekdays at 9am", "monday, friday at
// 17:30" or "day at 8:00" (what follows "every ") as a daily schedule.
func naturalSchedule(rest string) (Schedule, bool) {
	toks := strings.Fields(strings.ReplaceAll(strings.ToLower(rest), ",", " "))
	if len(toks) == 0 {
		return Schedule{}, false
	}
	var days []int
	idx := 1
	if d, ok := daySpecs[toks[0]]; ok {
		days = d
	} else {
		idx = len(toks)
		for i, t := range toks {
			if t == "and" {
				continue
			}
			d, ok := weekdayWords[t]
			if !ok {
				idx = i
				break
			}
			days = append(days, d)
		}
		if len(days) == 0 {
			return Schedule{}, false
		}
	}
	at := toks[idx:]
	if len(at) > 0 && at[0] == "at" {
		at = at[1:]
	}
	h, m, ok := clockTime(strings.Join(at, " "))
	if !ok {
		return Schedule{}, false
	}
	s, err := Schedule{DailyAt: fmt.Sprintf("%02d:%02d", h, m), Weekdays: days}.Normalize()
	return s, err == nil
}

// ParseSchedule reads a schedule a person or a model typed:
//
//	"every 6h", "30m", "every 2 days"  an interval (360, 30, 2880 minutes)
//	"every monday 9am", "weekdays at 9am"  a time on some days
//	"0 9 * * *"                            a five-field cron expression
//
// A time that happens once ("2026-12-01T09:00", "in 2h") is refused with
// ErrOneShot's words: that is a Reminder. It is a minimal parser with no
// new Go dependency.
func ParseSchedule(raw string) (Schedule, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return Schedule{}, invalid("Say when it runs, like every 6h, weekdays at 9am or 0 9 * * *")
	}
	low := strings.ToLower(text)
	every := strings.HasPrefix(low, "every ")
	rest := low
	if every {
		rest = strings.TrimSpace(text[6:])
	}
	if s, ok := naturalSchedule(rest); ok {
		return s, nil
	}
	if every {
		n, ok := parseDuration(rest)
		if !ok {
			return Schedule{}, invalid("I can't read %q as a schedule. Use every 6h, every monday 9am or a cron expression", clipKey(text))
		}
		return Schedule{EveryMinutes: n}.Normalize()
	}
	if parts := strings.Fields(text); len(parts) >= 5 && allCronish(parts[:5]) {
		if len(parts) > 5 {
			return Schedule{}, invalid("A cron expression has five fields: minute hour day month weekday")
		}
		return Schedule{Cron: text}.Normalize()
	}
	if isoRe.MatchString(text) || strings.HasPrefix(low, "in ") {
		return Schedule{}, invalid("That is a time that happens once. %s", sentence(ErrOneShot.Error()))
	}
	if n, ok := parseDuration(low); ok {
		return Schedule{EveryMinutes: n}.Normalize()
	}
	return Schedule{}, invalid("I can't read %q as a schedule. Use every 6h, every monday 9am or a cron expression", clipKey(text))
}

var cronishRe = regexp.MustCompile(`^[A-Za-z\d*\-,/]+$`)

func allCronish(parts []string) bool {
	for _, p := range parts {
		if !cronishRe.MatchString(p) {
			return false
		}
	}
	return true
}

// Cron is a parsed five-field expression: minute, hour, day of month,
// month, day of week. Like the classic cron, when both day fields are
// restricted a day matches if either does.
type Cron struct {
	expr                  string
	min, hour, dom, month uint64
	dow                   uint8
	domStar, dowStar      bool
}

type cronField struct {
	name     string
	lo, hi   int
	names    map[string]int
	allowSun bool // day of week: 7 is Sunday too
}

var (
	monthNames = map[string]int{"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
	dowNames   = map[string]int{"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}
	cronFields = [5]cronField{
		{name: "minute", lo: 0, hi: 59},
		{name: "hour", lo: 0, hi: 23},
		{name: "day of month", lo: 1, hi: 31},
		{name: "month", lo: 1, hi: 12, names: monthNames},
		{name: "day of week", lo: 0, hi: 7, names: dowNames, allowSun: true},
	}
)

// ParseCron reads a five-field cron expression: numbers, lists (1,15),
// ranges (1-5), steps (*/15, 9-17/2) and month and weekday names.
func ParseCron(expr string) (*Cron, error) {
	parts := strings.Fields(expr)
	if len(parts) != 5 {
		return nil, invalid("A cron expression has five fields: minute hour day month weekday")
	}
	var sets [5]uint64
	var stars [5]bool
	for i, p := range parts {
		set, star, err := cronFields[i].parse(p)
		if err != nil {
			return nil, err
		}
		sets[i], stars[i] = set, star
	}
	dow := sets[4]
	if dow&(1<<7) != 0 { // 7 is Sunday
		dow = dow&^(1<<7) | 1
	}
	c := &Cron{
		expr: strings.Join(parts, " "), min: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: uint8(dow),
		domStar: stars[2], dowStar: stars[4],
	}
	return c, nil
}

func (f cronField) parse(s string) (set uint64, star bool, err error) {
	bad := func(why string) error {
		return invalid("The %s field %q %s", f.name, clipKey(s), why)
	}
	star = strings.HasPrefix(s, "*")
	top := f.hi
	if f.allowSun {
		top = 6 // a bare "*" or a step over it stops at Saturday
	}
	for _, item := range strings.Split(s, ",") {
		rangePart, stepPart, hasStep := strings.Cut(item, "/")
		step := 1
		if hasStep {
			n, e := strconv.Atoi(stepPart)
			if e != nil || n < 1 {
				return 0, false, bad("has a step that is not a positive number")
			}
			step = n
		}
		var lo, hi int
		switch {
		case rangePart == "*":
			lo, hi = f.lo, top
		case strings.Contains(rangePart, "-"):
			a, b, _ := strings.Cut(rangePart, "-")
			x, ok1 := f.value(a)
			y, ok2 := f.value(b)
			if !ok1 || !ok2 {
				return 0, false, bad(fmt.Sprintf("is not a value from %d to %d", f.lo, f.hi))
			}
			if x > y {
				return 0, false, bad("has a range that runs backwards")
			}
			lo, hi = x, y
		default:
			x, ok := f.value(rangePart)
			if !ok {
				return 0, false, bad(fmt.Sprintf("is not a value from %d to %d", f.lo, f.hi))
			}
			lo, hi = x, x
			if hasStep {
				hi = top // "5/15" runs from 5 to the end
			}
		}
		for v := lo; v <= hi; v += step {
			set |= 1 << uint(v)
		}
	}
	if set == 0 {
		return 0, false, bad("matches nothing")
	}
	return set, star, nil
}

func (f cronField) value(s string) (int, bool) {
	if v, ok := f.names[strings.ToLower(s)]; ok {
		return v, true
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < f.lo || n > f.hi {
		return 0, false
	}
	return n, true
}

// nextWall is to, or an hour on from from when a clock change makes to no
// later, so Next always moves forward.
func nextWall(from, to time.Time) time.Time {
	if to.After(from) {
		return to
	}
	return from.Add(time.Hour)
}

// String is the expression with single spaces.
func (c *Cron) String() string { return c.expr }

func (c *Cron) dayMatches(t time.Time) bool {
	domOK := c.dom&(1<<uint(t.Day())) != 0
	dowOK := c.dow&(1<<uint(t.Weekday())) != 0
	switch {
	case c.domStar && c.dowStar:
		return true
	case c.domStar:
		return dowOK
	case c.dowStar:
		return domOK
	}
	return domOK || dowOK
}

// Next is the first matching minute strictly after after, on loc's wall
// clock; the zero Time when none comes in the next 8 years (for example
// "0 0 30 2 *").
func (c *Cron) Next(after time.Time, loc *time.Location) time.Time {
	if loc == nil {
		loc = time.UTC
	}
	t := after.In(loc).Truncate(time.Minute).Add(time.Minute)
	limit := t.AddDate(8, 0, 0)
	for t.Before(limit) {
		switch {
		case c.month&(1<<uint(t.Month())) == 0:
			t = nextWall(t, time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, loc))
		case !c.dayMatches(t):
			t = nextWall(t, time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, loc))
		case c.hour&(1<<uint(t.Hour())) == 0:
			t = nextWall(t, time.Date(t.Year(), t.Month(), t.Day(), t.Hour()+1, 0, 0, 0, loc))
		case c.min&(1<<uint(t.Minute())) == 0:
			t = t.Add(time.Minute)
		default:
			if t.After(after) {
				return t.UTC()
			}
			t = t.Add(time.Minute)
		}
	}
	return time.Time{}
}
