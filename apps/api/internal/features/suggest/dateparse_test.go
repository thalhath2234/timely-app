package suggest

import (
	"testing"
	"time"
)

func TestTitleDateReadsPlainPhrases(t *testing.T) {
	// Wednesday 14 October 2026, 10:00 in Berlin.
	loc, _ := time.LoadLocation("Europe/Berlin")
	now := time.Date(2026, 10, 14, 10, 0, 0, 0, loc)
	cases := []struct{ in, date, clock string }{
		{"call mom tomorrow", "2026-10-15", ""},
		{"Dentist tomorrow at 3pm", "2026-10-15", "15:00"},
		{"pay rent today", "2026-10-14", ""},
		{"send report friday", "2026-10-16", ""},
		{"send report by Friday 9:30am", "2026-10-16", "09:30"},
		{"review on wednesday", "2026-10-21", ""},
		{"plan trip next friday", "2026-10-23", ""},
		{"plan trip next monday", "2026-10-19", ""},
		{"renew passport 3 Nov", "2026-11-03", ""},
		{"taxes due April 15th", "2027-04-15", ""},
		{"book flights Oct 20 at 18:30", "2026-10-20", "18:30"},
		{"follow up in 3 days", "2026-10-17", ""},
		{"check back in a week", "2026-10-21", ""},
		{"start course next week", "2026-10-19", ""},
		{"lunch at noon tomorrow", "2026-10-15", "12:00"},
		{"deploy 2026-12-01", "2026-12-01", ""},
		{"clean garage this weekend", "2026-10-17", ""},
	}
	for _, c := range cases {
		date, clock, ok := titleDate(c.in, now)
		if !ok || date != c.date || clock != c.clock {
			t.Errorf("%q: got %q %q %v, want %q %q", c.in, date, clock, ok, c.date, c.clock)
		}
	}
	for _, in := range []string{"buy milk", "read chapter 3", "fix the mon-key bug", "31 June party", "call Fri3nd"} {
		if date, _, ok := titleDate(in, now); ok {
			t.Errorf("%q: read a date %q from words with none", in, date)
		}
	}
}

func TestTitleDateFalseMatchesAndDayParts(t *testing.T) {
	now := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC) // a Saturday afternoon
	for _, tc := range []struct{ text, date, clock string }{
		{"Call mom tonight", "2026-10-10", "19:00"},
		{"Finish the slides this afternoon", "2026-10-10", "15:00"},
		{"Call mom tonight at 9pm", "2026-10-10", "21:00"},
		{"Lunch with the 2 amigos tomorrow", "2026-10-11", "12:00"},
		{"Dentist on 3 may", "2027-05-03", ""},
	} {
		date, clock, ok := titleDate(tc.text, now)
		if !ok || date != tc.date || clock != tc.clock {
			t.Errorf("%q: got %q %q %v, want %q %q", tc.text, date, clock, ok, tc.date, tc.clock)
		}
	}
	if date, _, ok := titleDate("these 2 may help with the plan", now); ok {
		t.Errorf("read a date from a verb: %q", date)
	}
}

// Sunday 11 October 2026, 14:58: the afternoon the user reported the bug.
func sundayAfternoon() time.Time {
	loc, _ := time.LoadLocation("Asia/Colombo")
	return time.Date(2026, 10, 11, 14, 58, 0, 0, loc)
}

func TestTitleDateDayPartsAndTimes(t *testing.T) {
	now := sundayAfternoon()
	for _, tc := range []struct{ text, date, clock string }{
		// The two reports.
		{"Remind me to go to dentist Tuesday after noon", "2026-10-13", "15:00"},
		{"Remind me to take my cycle tomorrow morning", "2026-10-12", "09:00"},
		// A part of the day next to a day.
		{"tuesday morning standup", "2026-10-13", "09:00"},
		{"call the bank tuesday afternoon", "2026-10-13", "15:00"},
		{"call mom tonight", "2026-10-11", "19:00"},
		{"call mom tomorrow night", "2026-10-12", "21:00"},
		{"pick up parcel tomorrow evening", "2026-10-12", "19:00"},
		{"gym tomorrow early morning", "2026-10-12", "07:00"},
		{"lunch with Sam friday", "2026-10-16", "12:00"},
		{"send invoice eod friday", "2026-10-16", "17:00"},
		{"finish slides this afternoon", "2026-10-11", "15:00"},
		{"water plants this morning", "2026-10-11", "09:00"},
		// Clock times.
		{"dinner at 7pm", "2026-10-11", "19:00"},
		{"Tuesday 3.30pm dentist", "2026-10-13", "15:30"},
		{"tomorrow evening at 7:30", "2026-10-12", "19:30"},
		{"tomorrow at 7", "2026-10-12", "07:00"},
		{"tonight at 9", "2026-10-11", "21:00"},
		{"meeting at 14:00 tomorrow", "2026-10-12", "14:00"},
		{"day after tomorrow at noon", "2026-10-13", "12:00"},
		{"next tuesday at 9", "2026-10-13", "09:00"},
		{"call the plumber at 10 tomorrow", "2026-10-12", "10:00"},
		{"call back 5 o'clock", "2026-10-11", "17:00"},
		// A time with no day: today while still ahead, else tomorrow.
		{"call the bank at 5", "2026-10-11", "17:00"},
		{"call the bank at 9", "2026-10-12", "09:00"},
		{"pay rent at 10am", "2026-10-12", "10:00"},
		{"take pills at noon", "2026-10-12", "12:00"},
		{"stretch in the evening", "2026-10-11", "19:00"},
		{"meet Sam at lunch", "2026-10-12", "12:00"},
		// Relative moments.
		{"check the oven in 20 minutes", "2026-10-11", "15:18"},
		{"call back in 2 hours", "2026-10-11", "16:58"},
		{"stand up in half an hour", "2026-10-11", "15:28"},
		{"check in an hour", "2026-10-11", "15:58"},
		// Relative days.
		{"follow up in a couple of days", "2026-10-13", ""},
		{"follow up in two weeks", "2026-10-25", ""},
		{"follow up in a fortnight", "2026-10-25", ""},
		{"renew licence in 2 months", "2026-12-11", ""},
		{"plan budget next week", "2026-10-12", ""},
		{"plan budget next month", "2026-11-01", ""},
		{"file expenses end of month", "2026-10-31", ""},
		{"wrap up end of week", "2026-10-16", ""},
		{"clean garage this weekend", "2026-10-11", ""},
		{"clean garage next weekend", "2026-10-17", ""},
		// Weekdays, including the one it is today.
		{"call grandma sunday evening", "2026-10-11", "19:00"},
		{"call grandma sunday", "2026-10-18", ""},
		{"call grandma sunday morning", "2026-10-18", "09:00"},
		{"next sunday brunch", "2026-10-18", ""},
		{"groceries on sat", "2026-10-17", ""},
		{"book tickets by wed", "2026-10-14", ""},
		{"this coming friday", "2026-10-16", ""},
		// Dates.
		{"Oct 20 at 18:30 flight", "2026-10-20", "18:30"},
		{"20th October 3pm", "2026-10-20", "15:00"},
		{"pay card on the 20th", "2026-10-20", ""},
		{"pay card on the 5th", "2026-11-05", ""},
	} {
		date, clock, ok := titleDate(tc.text, now)
		if !ok || date != tc.date || clock != tc.clock {
			t.Errorf("%q: got %q %q %v, want %q %q", tc.text, date, clock, ok, tc.date, tc.clock)
		}
	}
}

func TestTitleDateLeavesOrdinaryWordsAlone(t *testing.T) {
	now := sundayAfternoon()
	for _, text := range []string{
		"lunch with Sam", "morning run playlist", "buy milk at 3 shops", "read John 3:16",
		"sat down with the team notes", "evening primrose seeds", "wed plans", "night mode bug",
		"2a section of the report", "renew my number card", "Do an audit on Timely",
	} {
		if date, clock, ok := titleDate(text, now); ok {
			t.Errorf("%q: read %q %q from words with no date", text, date, clock)
		}
	}
}

func TestAsksForReminder(t *testing.T) {
	for _, text := range []string{
		"Remind me to go to dentist Tuesday after noon", "remind me to take my cycle tomorrow morning",
		"Reminder: pay rent", "please remind me to call mom", "Ping me when the build is done",
		"Set a reminder for the dentist", "Don't let me forget the keys", "Can you remind me to stretch",
	} {
		if !asksForReminder(text) {
			t.Errorf("%q: not read as a reminder", text)
		}
	}
	for _, text := range []string{"Reminders app redesign", "Write the reminder emails", "Call mom tonight", "Remindful meditation"} {
		if asksForReminder(text) {
			t.Errorf("%q: read as a reminder", text)
		}
	}
}

func TestApplyWords(t *testing.T) {
	// Jev called the dentist an event and the date a reminder time; the
	// words ask for a reminder, so it is one, with its time filled.
	out := ClarifySuggestions{Available: true, LogID: "log", LooksLikeEvent: true, DateRole: "reminder"}
	applyWords(&out, "Remind me to go to dentist Tuesday after noon", "inb", "2026-10-13", "15:00", true)
	if out.Kind != "reminder" || out.LooksLikeEvent || out.DateRole != "reminder" || out.Date != "2026-10-13" || out.Time != "15:00" || out.LogID != "log" {
		t.Errorf("dentist: %+v", out)
	}
	// Jev said Work and gave the date as a deadline: kept.
	out = ClarifySuggestions{Available: true, LogID: "log", Kind: "task", DateRole: "deadline"}
	applyWords(&out, "send report by friday", "inb", "2026-10-16", "", true)
	if out.Kind != "task" || out.DateRole != "deadline" || out.Date != "2026-10-16" {
		t.Errorf("report: %+v", out)
	}
	// Work with a "reminder" time has no such field: the wording decides.
	out = ClarifySuggestions{Available: true, LogID: "log", Kind: "task", DateRole: "reminder"}
	applyWords(&out, "start the slides monday", "inb", "2026-10-12", "", true)
	if out.DateRole != "start" || out.Date != "2026-10-12" {
		t.Errorf("slides: %+v", out)
	}
	// Suggestions off: the words alone still make a reminder with its time.
	out = ClarifySuggestions{}
	applyWords(&out, "Remind me to take my cycle tomorrow morning", "inb", "2026-10-12", "09:00", true)
	if !out.Available || out.LogID != "words:inb" || out.Kind != "reminder" || out.DateRole != "reminder" || out.Time != "09:00" {
		t.Errorf("off, reminder: %+v", out)
	}
	// Suggestions off, a plain day on unknown kind: the wording names a deadline.
	out = ClarifySuggestions{}
	applyWords(&out, "pay the invoice by friday", "inb", "2026-10-16", "", true)
	if !out.Available || out.Kind != "" || out.DateRole != "deadline" || out.Date != "2026-10-16" {
		t.Errorf("off, deadline: %+v", out)
	}
	// "eod" is a deadline even with a time.
	out = ClarifySuggestions{}
	applyWords(&out, "Send invoice eod friday", "inb", "2026-10-16", "17:00", true)
	if out.DateRole != "deadline" || out.Date != "2026-10-16" {
		t.Errorf("off, eod: %+v", out)
	}
	// Suggestions off and nothing to read: still no answer.
	out = ClarifySuggestions{}
	applyWords(&out, "Do an audit on Timely", "inb", "", "", false)
	if out.Available || out.LogID != "" {
		t.Errorf("off, nothing: %+v", out)
	}
}
