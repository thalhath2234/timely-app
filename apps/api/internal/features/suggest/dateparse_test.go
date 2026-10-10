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
		{"Lunch with the 2 amigos tomorrow", "2026-10-11", ""},
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
