package extract

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t.UTC()
}

func TestParseFeed(t *testing.T) {
	cases := []struct {
		file, title string
		items       []FeedItem
	}{
		{"rss2.xml", "Frontpage Deals & Steals", []FeedItem{
			{ID: "deal-101", Title: "Noise-cancelling Headphones – $199 & free shipping", Link: "https://deals.example/d/101-headphones", Published: at("2026-11-06T08:30:00Z")},
			{ID: "deal-102", Title: "Chef’s Knife 40% off", Link: "https://deals.example/d/102-knife", Published: at("2026-11-05T21:05:00Z")},
			{ID: "https://deals.example/d/103-helmet", Title: "Kids’ Bike Helmet", Link: "https://deals.example/d/103-helmet", Published: at("2026-11-05T18:00:00Z")},
		}},
		{"atom.xml", "Release notes from widget", []FeedItem{
			{ID: "tag:code.example,2008:Repository/42/v2.1.0", Title: "v2.1.0 stable", Link: "https://code.example/acme/widget/releases/tag/v2.1.0", Published: at("2026-11-04T12:00:00Z")},
			{ID: "tag:code.example,2008:Repository/42/v2.0.0", Title: "v2.0.0 major release", Link: "https://code.example/acme/widget/releases/tag/v2.0.0", Published: at("2026-10-01T07:30:00Z")},
		}},
		{"rdf.xml", "Example Science News", []FeedItem{
			{ID: "https://news.example/a/1", Title: "Comet seen over the Alps", Link: "https://news.example/a/1", Published: at("2026-11-06T06:00:00Z")},
			{ID: "https://news.example/a/2", Title: "Café study finds nothing new", Link: "https://news.example/a/2"},
		}},
		{"jsonfeed.json", "Notes from Ana", []FeedItem{
			{ID: "https://ana.example/2026/11/rust", Title: "Learning Rust, week 3", Link: "https://ana.example/2026/11/rust", Published: at("2026-11-06T00:00:00Z")},
			{ID: "1042", Title: "A short note with no title.", Published: at("2026-11-03T10:00:00Z")},
			{ID: "https://other.example/great-read", Title: "A great read elsewhere", Link: "https://other.example/great-read"},
		}},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			body := fixture(t, c.file)
			f, err := ParseFeed(body)
			if err != nil {
				t.Fatal(err)
			}
			if f.Title != c.title {
				t.Errorf("Title = %q, want %q", f.Title, c.title)
			}
			if len(f.Items) != len(c.items) {
				t.Fatalf("got %d items: %+v", len(f.Items), f.Items)
			}
			for i, want := range c.items {
				if got := f.Items[i]; got != want {
					t.Errorf("item %d =\n %+v\nwant\n %+v", i, got, want)
				}
			}
			// IDs are stable: a second read gives the same ones.
			again, _ := ParseFeed(body)
			for i := range f.Items {
				if again.Items[i].ID != f.Items[i].ID {
					t.Fatalf("item %d ID moved: %q then %q", i, f.Items[i].ID, again.Items[i].ID)
				}
			}
		})
	}
}

func TestParseFeedHashID(t *testing.T) {
	feed := `<rss version="2.0"><channel><title>t</title>
<item><title>No guid or link</title></item>
<item><title>Long guid</title><guid>` + strings.Repeat("g", 300) + `</guid></item>
<item><description>&lt;p&gt;Only a &lt;b&gt;description&lt;/b&gt;&lt;/p&gt;</description></item>
<item></item>
</channel></rss>`
	f, err := ParseFeed([]byte(feed))
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Items) != 3 {
		t.Fatalf("items = %+v", f.Items)
	}
	if id := f.Items[0].ID; id != hashID("No guid or link|") {
		t.Errorf("fallback ID = %q", id)
	}
	if id := f.Items[1].ID; id != hashID(strings.Repeat("g", 300)) {
		t.Errorf("long guid ID = %q", id)
	}
	if got := f.Items[2].Title; got != "Only a description" {
		t.Errorf("description title = %q", got)
	}
}

func TestParseFeedEmptyAndNotFeed(t *testing.T) {
	if _, err := ParseFeed(fixture(t, "empty_feed.xml")); !errors.Is(err, ErrEmpty) {
		t.Fatalf("empty feed err = %v, want ErrEmpty", err)
	}
	for _, body := range [][]byte{
		fixture(t, "not_a_feed.html"),
		[]byte(`{"items":[{"id":"1"}]}`),
		[]byte("<rss><title>no channel</title></rss>"),
		[]byte("<feed><entry><id>1</id></entry></feed>"), // no Atom namespace
		[]byte(""),
		[]byte("plain text"),
	} {
		if _, err := ParseFeed(body); !errors.Is(err, ErrNotFeed) {
			t.Errorf("ParseFeed(%.30q) err = %v, want ErrNotFeed", body, err)
		}
	}
}

func TestParseFeedTolerant(t *testing.T) {
	// A BOM, a JSON Feed 1.0 version, and an RSS item left open.
	jf := "\ufeff" + `{"version":"https://jsonfeed.org/version/1","title":"x","items":[{"id":"a","title":"A"}]}`
	if f, err := ParseFeed([]byte(jf)); err != nil || f.Items[0].ID != "a" {
		t.Fatalf("JSON Feed 1.0: %+v, %v", f, err)
	}
	rss := `<rss version="2.0"><channel><title>t</title><item><title>One</title><guid>1</guid></item><item><title>Two</title><guid>2</guid>`
	f, err := ParseFeed([]byte(rss))
	if err != nil || len(f.Items) != 2 {
		t.Fatalf("truncated RSS: %+v, %v", f, err)
	}
}

func TestFeedItemJSON(t *testing.T) {
	b, err := json.Marshal(FeedItem{ID: "1", Title: "A"})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"id":"1","title":"A"}` {
		t.Fatalf("json = %s", b)
	}
}

func TestParseDate(t *testing.T) {
	for in, want := range map[string]string{
		"Fri, 06 Nov 2026 08:30:00 +0000": "2026-11-06T08:30:00Z",
		"Fri, 6 Nov 2026 08:30:00 GMT":    "2026-11-06T08:30:00Z",
		"06 Nov 26 08:30 +0530":           "2026-11-06T03:00:00Z",
		"2026-11-06T08:30:00.123+01:00":   "2026-11-06T07:30:00.123Z",
		"2026-11-06":                      "2026-11-06T00:00:00Z",
	} {
		if got := parseDate(in).Format(time.RFC3339Nano); got != want {
			t.Errorf("parseDate(%q) = %s, want %s", in, got, want)
		}
	}
	if !parseDate("yesterday").IsZero() {
		t.Error("an unreadable date should be zero")
	}
}
