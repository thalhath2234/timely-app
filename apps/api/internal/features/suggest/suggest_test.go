package suggest

import "testing"

func TestNamedIn(t *testing.T) {
	projects := []namedProject{
		{ID: "t", Title: "Timely"},
		{ID: "tw", Title: "Timely website"},
		{ID: "h", Title: "Hobby"},
		{ID: "h2", Title: "hobby"},
	}
	for _, tc := range []struct {
		title, want string
	}{
		{"Do an audit on Timely", "t"},
		{"Fix the timely website footer", "tw"}, // the longer name wins
		{"Timelyish thoughts", ""},              // whole words only
		{"Sort out hobby gear", ""},             // two projects, same name
		{"Buy milk", ""},
	} {
		got, ok := namedIn(tc.title, projects)
		if (tc.want == "") == ok || (ok && got.ID != tc.want) {
			t.Errorf("%q: got %q %v, want %q", tc.title, got.ID, ok, tc.want)
		}
	}
}
