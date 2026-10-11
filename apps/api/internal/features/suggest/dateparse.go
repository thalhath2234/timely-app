package suggest

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Plan item 8: code reads the date in a thought's words and Jev only says
// what it is for (deadline, start or reminder). titleDate understands the
// plain phrases people type into a capture box; anything else is left alone,
// so the form only points at the field as before.

var (
	weekdays = map[string]time.Weekday{
		"sunday": time.Sunday, "sun": time.Sunday, "monday": time.Monday, "mon": time.Monday,
		"tuesday": time.Tuesday, "tue": time.Tuesday, "tues": time.Tuesday, "wednesday": time.Wednesday,
		"wed": time.Wednesday, "thursday": time.Thursday, "thu": time.Thursday, "thurs": time.Thursday,
		"friday": time.Friday, "fri": time.Friday, "saturday": time.Saturday, "sat": time.Saturday,
	}
	months = map[string]time.Month{
		"jan": time.January, "january": time.January, "feb": time.February, "february": time.February,
		"mar": time.March, "march": time.March, "apr": time.April, "april": time.April, "may": time.May,
		"jun": time.June, "june": time.June, "jul": time.July, "july": time.July, "aug": time.August,
		"august": time.August, "sep": time.September, "sept": time.September, "september": time.September,
		"oct": time.October, "october": time.October, "nov": time.November, "november": time.November,
		"dec": time.December, "december": time.December,
	}
	monthNames = `(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`
	reISO      = regexp.MustCompile(`\b(\d{4})-(\d{2})-(\d{2})\b`)
	reDayMonth = regexp.MustCompile(`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?` + monthNames + `\b`)
	// "these 2 may help" is not May 2: "may" followed by another word is the verb.
	reMayVerb  = regexp.MustCompile(`^\s+[a-z]`)
	reMonthDay = regexp.MustCompile(`\b` + monthNames + `\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`)
	// "on the 20th": the next 20th of a month.
	reOrdinalDay = regexp.MustCompile(`\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b`)
	reDayAfter   = regexp.MustCompile(`\bday after tomorrow\b`)
	reTomorrow   = regexp.MustCompile(`\b(tomorrow|tmrw|tmr|tmrow)\b`)
	reToday      = regexp.MustCompile(`\b(today|tonight|tonite|this evening|this afternoon|this morning)\b`)
	reInDays     = regexp.MustCompile(`\bin\s+(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a couple of|a few)\s+(day|days|week|weeks|month|months)\b`)
	reInHours    = regexp.MustCompile(`\bin\s+(\d{1,3}|an|a|one|two|three|half an?)\s*(minutes?|mins?|hours?|hrs?|h)\b`)
	reFortnight  = regexp.MustCompile(`\bin\s+a\s+fortnight\b`)
	reNextWeek   = regexp.MustCompile(`\bnext week\b`)
	reNextMonth  = regexp.MustCompile(`\bnext month\b`)
	reEndOfWeek  = regexp.MustCompile(`\bend of (the )?week\b`)
	reEndOfMonth = regexp.MustCompile(`\bend of (the )?month\b`)
	reWeekend    = regexp.MustCompile(`\b(this |next )?weekend\b`)
	// Short forms that are also words ("sat", "wed", "sun", "mon") count only
	// after a word that makes them a day: "on sat", "next wed", "by mon".
	reWeekday      = regexp.MustCompile(`\b(next\s+|this\s+|coming\s+|this\s+coming\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues?|thu(?:rs)?|fri)(?:[^\w-]|$)`)
	reWeekdayShort = regexp.MustCompile(`\b(on|next|this|by|until|till|before|every|coming)\s+(sun|mon|wed|sat)(?:[^\w-]|$)`)
	reClock        = regexp.MustCompile(`\b(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)(?:[^\w]|$)`)
	// "15:00" counts next to a day or after "at"/"by"; alone ("John 3:16") it does not.
	reClock24 = regexp.MustCompile(`(?:^|[^\d:.])(?:(at|@|by|until|till|from|around)\s*)?([01]?\d|2[0-3]):([0-5]\d)(?:[^\d:]|$)`)
	// "at 5", "@ 5", "5 o'clock": a bare hour, read as the likelier half of the day.
	reBareHour  = regexp.MustCompile(`(?:\bat\s+|@\s*)(\d{1,2})(?:\s*o'?clock)?(?:\s+(\w+)|[^\w\s]|$)|\b(\d{1,2})\s*o'?clock\b`)
	reNoon      = regexp.MustCompile(`\b(noon|midday)\b`)
	reAfterNoon = regexp.MustCompile(`\bafter\s*noon\b|\bafternoon\b`)
	smallNumber = map[string]int{
		"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
		"seven": 7, "eight": 8, "nine": 9, "ten": 10, "a couple of": 2, "a few": 3,
	}
	// Words that may follow "at 5" without making the 5 a count ("at 3 shops").
	bareHourNext = map[string]bool{
		"today": true, "tomorrow": true, "tonight": true, "tonite": true, "on": true, "this": true,
		"next": true, "and": true, "then": true, "in": true, "morning": true, "afternoon": true,
		"evening": true, "night": true, "sharp": true, "or": true, "with": true, "for": true,
		"to": true, "please": true, "o": true,
	}
)

// A part of the day stands in for a clock time when no time is given.
var dayParts = []struct {
	re    *regexp.Regexp
	clock string
	pm    bool
}{
	{regexp.MustCompile(`\bearly morning\b`), "07:00", false},
	{regexp.MustCompile(`\b(morning|mornin)\b`), "09:00", false},
	{regexp.MustCompile(`\b(lunch|lunchtime|lunch time)\b`), "12:00", true},
	{regexp.MustCompile(`\bafter\s*noon\b|\bafternoon\b`), "15:00", true},
	{regexp.MustCompile(`\b(end of (the )?day|eod|after work)\b`), "17:00", true},
	{regexp.MustCompile(`\b(evening|tonight|tonite)\b`), "19:00", true},
	{regexp.MustCompile(`\bnight\b`), "21:00", true},
}

// dayPart is the part of the day the words name, if any. alone says whether a
// bare word ("lunch with Sam", "morning run") counts: it does only next to a
// day ("tomorrow morning"), otherwise the words need "this", "in the" or
// "tonight" to mean a time.
func dayPart(s string, withDay bool) (clock string, pm, ok bool) {
	for _, p := range dayParts {
		loc := p.re.FindStringIndex(s)
		if loc == nil {
			continue
		}
		word := s[loc[0]:loc[1]]
		before := strings.TrimSpace(s[:loc[0]])
		if withDay || strings.HasPrefix(word, "toni") || word == "eod" || strings.HasPrefix(word, "end of") ||
			strings.HasSuffix(before, "this") || strings.HasSuffix(before, "in the") ||
			strings.HasSuffix(before, "at") || strings.HasSuffix(before, "by") {
			return p.clock, p.pm, true
		}
	}
	return "", false, false
}

// titleDate finds the first date (and a time, if one is given) in text,
// relative to now in the person's own timezone. date is YYYY-MM-DD; clock is
// HH:MM or "". A time with no day ("call mom at 5pm") is today while it is
// still ahead, else tomorrow.
func titleDate(text string, now time.Time) (date, clock string, ok bool) {
	s := strings.ToLower(strings.Join(strings.Fields(text), " "))
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// "in 2 hours" names the moment itself.
	if m := reInHours.FindStringSubmatch(s); m != nil {
		n := 0
		switch {
		case strings.HasPrefix(m[1], "half"):
			n = 30
		default:
			if v, err := strconv.Atoi(m[1]); err == nil {
				n = v
			} else {
				n = smallNumber[m[1]]
			}
			if strings.HasPrefix(m[2], "h") {
				n *= 60
			}
		}
		if n > 0 {
			at := now.Add(time.Duration(n) * time.Minute)
			return at.Format("2006-01-02"), clockText(at.Hour(), at.Minute()), true
		}
	}

	var day time.Time
	found := true
	sameDayOK := false // a weekday named on that same day may mean today
	switch {
	case reISO.MatchString(s):
		m := reISO.FindStringSubmatch(s)
		t, err := time.ParseInLocation("2006-01-02", m[0], now.Location())
		if err != nil {
			return "", "", false
		}
		day = t
	case reDayMonth.MatchString(s) && !mayVerb(s):
		m := reDayMonth.FindStringSubmatch(s)
		day, found = monthDay(today, m[2], m[1])
	case reMonthDay.MatchString(s):
		m := reMonthDay.FindStringSubmatch(s)
		day, found = monthDay(today, m[1], m[2])
	case reDayAfter.MatchString(s):
		day = today.AddDate(0, 0, 2)
	case reTomorrow.MatchString(s):
		day = today.AddDate(0, 0, 1)
	case reToday.MatchString(s):
		day = today
	case reFortnight.MatchString(s):
		day = today.AddDate(0, 0, 14)
	case reInDays.MatchString(s):
		m := reInDays.FindStringSubmatch(s)
		n, err := strconv.Atoi(m[1])
		if err != nil {
			n = smallNumber[m[1]]
		}
		switch {
		case strings.HasPrefix(m[2], "week"):
			day = today.AddDate(0, 0, n*7)
		case strings.HasPrefix(m[2], "month"):
			day = today.AddDate(0, n, 0)
		default:
			day = today.AddDate(0, 0, n)
		}
	case reNextWeek.MatchString(s):
		// Monday of next week.
		day = today.AddDate(0, 0, (8-int(today.Weekday()))%7)
		if day.Equal(today) {
			day = day.AddDate(0, 0, 7)
		}
	case reNextMonth.MatchString(s):
		day = time.Date(today.Year(), today.Month()+1, 1, 0, 0, 0, 0, today.Location())
	case reEndOfMonth.MatchString(s):
		day = time.Date(today.Year(), today.Month()+1, 0, 0, 0, 0, 0, today.Location())
	case reEndOfWeek.MatchString(s):
		day = today.AddDate(0, 0, (int(time.Friday)-int(today.Weekday())+7)%7)
	case reWeekend.MatchString(s):
		// The coming Saturday, or today when it is already the weekend.
		m := reWeekend.FindStringSubmatch(s)
		day = today.AddDate(0, 0, (int(time.Saturday)-int(today.Weekday())+7)%7)
		if today.Weekday() == time.Sunday {
			day = today
		}
		if strings.HasPrefix(m[1], "next") {
			day = day.AddDate(0, 0, (int(time.Saturday)-int(day.Weekday())+7)%7)
			if !day.After(today) || today.Weekday() != time.Sunday && today.Weekday() != time.Saturday {
				day = day.AddDate(0, 0, 7)
			}
		}
	case reWeekday.MatchString(s) || reWeekdayShort.MatchString(s):
		var prefix, name string
		if m := reWeekday.FindStringSubmatch(s); m != nil {
			prefix, name = strings.TrimSpace(m[1]), m[2]
		} else {
			m := reWeekdayShort.FindStringSubmatch(s)
			prefix, name = m[1], m[2]
		}
		target := weekdays[name]
		ahead := (int(target) - int(today.Weekday()) + 7) % 7
		if ahead == 0 {
			ahead = 7 // "friday" said on a Friday means the next one, unless a later time today fits
			sameDayOK = prefix == "" || prefix == "this" || prefix == "on" || prefix == "by"
		}
		// "next friday" said on a Monday means next week's, not this week's.
		if daysToSunday := 6 - (int(today.Weekday())+6)%7; prefix == "next" && ahead <= daysToSunday {
			ahead += 7
		}
		day = today.AddDate(0, 0, ahead)
	case reOrdinalDay.MatchString(s):
		m := reOrdinalDay.FindStringSubmatch(s)
		n, _ := strconv.Atoi(m[1])
		day, found = nextMonthDay(today, n)
	default:
		found = false
	}

	clock = titleClock(s, found)
	if !found {
		if clock == "" {
			return "", "", false
		}
		// Only a time: today while it is still ahead, else tomorrow.
		day = today
		if at := atClock(day, clock); !at.After(now) {
			day = today.AddDate(0, 0, 1)
		}
	}
	if sameDayOK && clock != "" {
		if at := atClock(today, clock); at.After(now) {
			day = today
		}
	}
	return day.Format("2006-01-02"), clock, true
}

func atClock(day time.Time, clock string) time.Time {
	h, _ := strconv.Atoi(clock[:2])
	m, _ := strconv.Atoi(clock[3:])
	return time.Date(day.Year(), day.Month(), day.Day(), h, m, 0, 0, day.Location())
}

// mayVerb is true when the day-month match ends in "may" used as a verb.
func mayVerb(s string) bool {
	loc := reDayMonth.FindStringSubmatchIndex(s)
	return loc != nil && s[loc[4]:loc[5]] == "may" && reMayVerb.MatchString(s[loc[1]:])
}

// monthDay is the next date with that month and day, this year or next.
func monthDay(today time.Time, month, dayText string) (time.Time, bool) {
	mon, ok := months[strings.TrimSuffix(month, ".")]
	if !ok {
		return time.Time{}, false
	}
	d, err := strconv.Atoi(dayText)
	if err != nil || d < 1 || d > 31 {
		return time.Time{}, false
	}
	t := time.Date(today.Year(), mon, d, 0, 0, 0, 0, today.Location())
	if t.Month() != mon {
		return time.Time{}, false // 31 June
	}
	if t.Before(today) {
		t = t.AddDate(1, 0, 0)
	}
	return t, true
}

// nextMonthDay is the next date on that day of a month, today included.
func nextMonthDay(today time.Time, d int) (time.Time, bool) {
	if d < 1 || d > 31 {
		return time.Time{}, false
	}
	for i := 0; i < 3; i++ {
		t := time.Date(today.Year(), today.Month()+time.Month(i), d, 0, 0, 0, 0, today.Location())
		if t.Day() == d && !t.Before(today) {
			return t, true
		}
	}
	return time.Time{}, false
}

// titleClock reads "3pm", "at 3:30 pm", "15:00", "at 5", "noon" or a part of
// the day ("tomorrow morning", "this evening") as HH:MM. withDay says the
// words also name a day, so a bare "morning" or "lunch" counts as a time.
func titleClock(s string, withDay bool) string {
	part, partPM, hasPart := dayPart(s, withDay)
	if m := reClock.FindStringSubmatch(s); m != nil {
		h, _ := strconv.Atoi(m[1])
		mins := 0
		if m[2] != "" {
			mins, _ = strconv.Atoi(m[2])
		}
		if h >= 1 && h <= 12 && mins <= 59 {
			if strings.HasPrefix(m[3], "p") && h != 12 {
				h += 12
			}
			if strings.HasPrefix(m[3], "a") && h == 12 {
				h = 0
			}
			return clockText(h, mins)
		}
	}
	if m := reClock24.FindStringSubmatch(s); m != nil && (withDay || m[1] != "") {
		h, _ := strconv.Atoi(m[2])
		mins, _ := strconv.Atoi(m[3])
		if h < 13 && hasPart && partPM && h != 12 {
			h += 12 // "tomorrow evening 7:30"
		}
		return clockText(h, mins)
	}
	if reNoon.MatchString(s) && !reAfterNoon.MatchString(s) {
		return "12:00"
	}
	if m := reBareHour.FindStringSubmatch(s); m != nil {
		text, next := m[1], m[2]
		if text == "" {
			text = m[3]
		}
		if next == "" || bareHourNext[next] {
			if h, err := strconv.Atoi(text); err == nil && h >= 0 && h <= 23 {
				switch {
				case h > 12 || h == 0:
					// Already a 24-hour hour.
				case hasPart:
					if partPM && h != 12 {
						h += 12
					}
					if !partPM && h == 12 {
						h = 0
					}
				case h <= 6:
					h += 12 // "at 5" is five in the afternoon
				}
				return clockText(h, 0)
			}
		}
	}
	if hasPart {
		return part
	}
	return ""
}

func clockText(h, m int) string {
	return strconv.Itoa(100 + h)[1:] + ":" + strconv.Itoa(100 + m)[1:]
}

// reReminderAsk is a thought that asks to be reminded, in so many words.
var reReminderAsk = regexp.MustCompile(`^(?:please\s+|pls\s+)?(?:remind me\b|reminder\b|ping me\b|nudge me\b|alert me\b|notify me\b|set (?:a|an) (?:reminder|alarm)\b|don'?t let me forget\b)|\b(?:remind me|set a reminder)\b`)

// asksForReminder is true when the words themselves ask for a reminder
// ("Remind me to call the dentist", "reminder: pay rent"). That is a plain
// fact, so it wins over Jev's reading of the thought.
func asksForReminder(text string) bool {
	return reReminderAsk.MatchString(strings.ToLower(strings.TrimSpace(text)))
}

var (
	reDeadlineWord = regexp.MustCompile(`\b(by|due|before|until|till|deadline|no later than|eod|end of (the )?day)\b`)
	reStartWord    = regexp.MustCompile(`\b(start|starting|starts|begin|beginning|kick off)\b`)
)

// dateRoleFromWords says what a date read from the words is for when Jev
// gave no answer: a reminder's date is when it pings, "by Friday" is a
// deadline and "start Monday" a start. A work item with a plain day and no
// time reads as its deadline; one with a time is left for the person.
func dateRoleFromWords(text, kind, clock string) string {
	s := strings.ToLower(text)
	switch {
	case kind == "reminder":
		return "reminder"
	case reDeadlineWord.MatchString(s):
		return "deadline"
	case reStartWord.MatchString(s):
		return "start"
	case kind == "task" && clock == "":
		return "deadline"
	}
	return ""
}
