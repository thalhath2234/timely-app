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
	reMonthDay = regexp.MustCompile(`\b` + monthNames + `\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`)
	reInDays   = regexp.MustCompile(`\bin\s+(\d{1,2}|a|one|two|three)\s+(day|days|week|weeks)\b`)
	// Short forms that are also words ("sat", "wed", "sun", "mon") are left out.
	reWeekday   = regexp.MustCompile(`\b(next\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues?|thu(?:rs)?|fri)(?:[^\w-]|$)`)
	reClock     = regexp.MustCompile(`\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)`)
	reClock24   = regexp.MustCompile(`\bat\s+(\d{1,2}):(\d{2})\b`)
	smallNumber = map[string]int{"a": 1, "one": 1, "two": 2, "three": 3}
)

// titleDate finds the first date (and a time, if one is given) in text,
// relative to now in the person's own timezone. date is YYYY-MM-DD; clock is
// HH:MM or "".
func titleDate(text string, now time.Time) (date, clock string, ok bool) {
	s := strings.ToLower(text)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var day time.Time
	found := true
	switch {
	case reISO.MatchString(s):
		m := reISO.FindStringSubmatch(s)
		t, err := time.ParseInLocation("2006-01-02", m[0], now.Location())
		if err != nil {
			return "", "", false
		}
		day = t
	case reDayMonth.MatchString(s):
		m := reDayMonth.FindStringSubmatch(s)
		day, found = monthDay(today, m[2], m[1])
	case reMonthDay.MatchString(s):
		m := reMonthDay.FindStringSubmatch(s)
		day, found = monthDay(today, m[1], m[2])
	case strings.Contains(s, "day after tomorrow"):
		day = today.AddDate(0, 0, 2)
	case regexp.MustCompile(`\b(tomorrow|tmrw|tmr)\b`).MatchString(s):
		day = today.AddDate(0, 0, 1)
	case regexp.MustCompile(`\b(today|tonight|this evening|this afternoon|this morning)\b`).MatchString(s):
		day = today
	case reInDays.MatchString(s):
		m := reInDays.FindStringSubmatch(s)
		n, err := strconv.Atoi(m[1])
		if err != nil {
			n = smallNumber[m[1]]
		}
		if strings.HasPrefix(m[2], "week") {
			n *= 7
		}
		day = today.AddDate(0, 0, n)
	case regexp.MustCompile(`\bnext week\b`).MatchString(s):
		day = today.AddDate(0, 0, (8-int(today.Weekday()))%7)
		if day.Equal(today) {
			day = day.AddDate(0, 0, 7)
		}
	case regexp.MustCompile(`\bend of (the )?week\b`).MatchString(s):
		day = today.AddDate(0, 0, (int(time.Friday)-int(today.Weekday())+7)%7)
	case regexp.MustCompile(`\b(this )?weekend\b`).MatchString(s):
		day = today.AddDate(0, 0, (int(time.Saturday)-int(today.Weekday())+7)%7)
	case reWeekday.MatchString(s):
		m := reWeekday.FindStringSubmatch(s)
		target := weekdays[m[2]]
		ahead := (int(target) - int(today.Weekday()) + 7) % 7
		if ahead == 0 {
			ahead = 7 // "friday" said on a Friday means the next one
		}
		// "next friday" said on a Monday means next week's, not this week's.
		if daysToSunday := 6 - (int(today.Weekday())+6)%7; strings.HasPrefix(m[1], "next") && ahead <= daysToSunday {
			ahead += 7
		}
		day = today.AddDate(0, 0, ahead)
	default:
		found = false
	}
	if !found {
		return "", "", false
	}
	return day.Format("2006-01-02"), titleClock(s), true
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

// titleClock reads "3pm", "at 3:30 pm", "at 15:00" or "noon" as HH:MM.
func titleClock(s string) string {
	if strings.Contains(s, "noon") || strings.Contains(s, "midday") {
		return "12:00"
	}
	if m := reClock.FindStringSubmatch(s); m != nil {
		h, _ := strconv.Atoi(m[1])
		mins := 0
		if m[2] != "" {
			mins, _ = strconv.Atoi(m[2])
		}
		if h < 1 || h > 12 || mins > 59 {
			return ""
		}
		if strings.HasPrefix(m[3], "p") && h != 12 {
			h += 12
		}
		if strings.HasPrefix(m[3], "a") && h == 12 {
			h = 0
		}
		return clockText(h, mins)
	}
	if m := reClock24.FindStringSubmatch(s); m != nil {
		h, _ := strconv.Atoi(m[1])
		mins, _ := strconv.Atoi(m[2])
		if h > 23 || mins > 59 {
			return ""
		}
		return clockText(h, mins)
	}
	return ""
}

func clockText(h, m int) string {
	return strconv.Itoa(100 + h)[1:] + ":" + strconv.Itoa(100 + m)[1:]
}
