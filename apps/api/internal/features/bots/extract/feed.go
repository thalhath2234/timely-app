package extract

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"

	"timely-api/internal/utils"
)

// FeedItem is one entry of a feed. ID is stable across reads: the guid or
// id, else the link, else a hash of the title and link.
type FeedItem struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Link      string    `json:"link,omitempty"`
	Published time.Time `json:"published,omitzero"`
}

type Feed struct {
	Title string
	Items []FeedItem
}

const (
	maxTitle  = 300
	maxLink   = 2048
	maxID     = 200
	nsAtom    = "http://www.w3.org/2005/Atom"
	nsRSS1    = "http://purl.org/rss/1.0/"
	nsDC      = "http://purl.org/dc/elements/1.1/"
	nsRDF     = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
	nsContent = "http://purl.org/rss/1.0/modules/content/"
)

// ParseFeed reads RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed 1.0/1.1, with
// items in feed order and repeats dropped. Anything else gives ErrNotFeed;
// a feed with no items gives ErrEmpty.
func ParseFeed(body []byte) (Feed, error) {
	body = bytes.TrimPrefix(body, []byte("\xef\xbb\xbf"))
	if t := bytes.TrimSpace(body); len(t) > 0 && t[0] == '{' {
		return parseJSONFeed(t)
	}
	root, err := parseXML(body)
	if err != nil {
		return Feed{}, ErrNotFeed
	}
	var f Feed
	switch {
	case root.local == "rss":
		ch := root.child("", "channel")
		if ch == nil {
			return Feed{}, ErrNotFeed
		}
		f.Title = cleanText(ch.childText("", "title"))
		for _, it := range ch.children("", "item") {
			f.add(rssItem(it, ""))
		}
	case root.local == "RDF" && root.space == nsRDF:
		if ch := root.child(nsRSS1, "channel"); ch != nil {
			f.Title = cleanText(ch.childText(nsRSS1, "title"))
		}
		for _, it := range root.children(nsRSS1, "item") {
			f.add(rssItem(it, nsRSS1))
		}
	case root.local == "feed" && root.space == nsAtom:
		f.Title = cleanText(root.child(nsAtom, "title").deepText())
		for _, e := range root.children(nsAtom, "entry") {
			f.add(atomEntry(e))
		}
	default:
		return Feed{}, ErrNotFeed
	}
	return f.done()
}

func rssItem(it *xnode, ns string) rawItem {
	r := rawItem{
		title:   it.childText(ns, "title"),
		link:    it.childText(ns, "link"),
		summary: it.childText(ns, "description"),
	}
	if r.summary == "" {
		r.summary = it.childText(nsContent, "encoded")
	}
	if ns == "" {
		if g := it.child("", "guid"); g != nil {
			r.id = strings.TrimSpace(g.text.String())
			if r.link == "" && !strings.EqualFold(g.attr("", "isPermaLink"), "false") {
				r.link = r.id
			}
		}
		r.published = parseDate(it.childText("", "pubDate"))
	} else {
		r.id = it.attr(nsRDF, "about")
	}
	if r.published.IsZero() {
		r.published = parseDate(it.childText(nsDC, "date"))
	}
	return r
}

func atomEntry(e *xnode) rawItem {
	r := rawItem{
		id:      e.childText(nsAtom, "id"),
		title:   e.child(nsAtom, "title").deepText(),
		summary: e.child(nsAtom, "summary").deepText(),
	}
	for _, l := range e.children(nsAtom, "link") {
		rel := l.attr("", "rel")
		if rel == "" || rel == "alternate" {
			r.link = l.attr("", "href")
			break
		}
	}
	r.published = parseDate(e.childText(nsAtom, "published"))
	if r.published.IsZero() {
		r.published = parseDate(e.childText(nsAtom, "updated"))
	}
	return r
}

func parseJSONFeed(body []byte) (Feed, error) {
	var jf struct {
		Version string `json:"version"`
		Title   string `json:"title"`
		Items   []struct {
			ID            any    `json:"id"`
			URL           string `json:"url"`
			ExternalURL   string `json:"external_url"`
			Title         string `json:"title"`
			Summary       string `json:"summary"`
			ContentText   string `json:"content_text"`
			ContentHTML   string `json:"content_html"`
			DatePublished string `json:"date_published"`
			DateModified  string `json:"date_modified"`
		} `json:"items"`
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	if err := d.Decode(&jf); err != nil || !strings.Contains(jf.Version, "jsonfeed.org/version/") {
		return Feed{}, ErrNotFeed
	}
	f := Feed{Title: cleanText(jf.Title)}
	for _, it := range jf.Items {
		r := rawItem{
			title:     it.Title,
			link:      it.URL,
			summary:   firstNonEmpty(it.Summary, it.ContentText, it.ContentHTML),
			published: parseDate(it.DatePublished),
		}
		switch id := it.ID.(type) {
		case string:
			r.id = id
		case json.Number:
			r.id = id.String()
		}
		if r.link == "" {
			r.link = it.ExternalURL
		}
		if r.published.IsZero() {
			r.published = parseDate(it.DateModified)
		}
		f.add(r)
	}
	return f.done()
}

// rawItem is an item as the feed spells it, before cleaning.
type rawItem struct {
	id, title, link, summary string
	published                time.Time
}

func (f *Feed) add(r rawItem) {
	title := cleanText(r.title)
	if title == "" {
		// Some RSS items have only a description.
		title = cleanText(r.summary)
	}
	it := FeedItem{
		Title:     utils.ClipUTF8(title, maxTitle),
		Link:      cleanLink(r.link),
		Published: r.published,
	}
	id := strings.TrimSpace(r.id)
	if id == "" {
		id = it.Link
	}
	if id == "" {
		id = hashID(title + "|" + it.Link)
	} else if len(id) > maxID {
		id = hashID(id)
	}
	it.ID = utils.StorableText(id, maxID)
	if it.ID == "" || (it.Title == "" && it.Link == "") {
		return
	}
	for _, seen := range f.Items {
		if seen.ID == it.ID {
			return
		}
	}
	f.Items = append(f.Items, it)
}

func (f Feed) done() (Feed, error) {
	f.Title = utils.ClipUTF8(f.Title, maxTitle)
	if len(f.Items) == 0 {
		return f, ErrEmpty
	}
	return f, nil
}

func hashID(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// cleanText turns a feed's text into one plain line. Titles are often
// escaped HTML ("&amp;#8217;", "<b>"), so markup and entities are resolved.
func cleanText(s string) string {
	if strings.ContainsAny(s, "<&") {
		if doc, err := html.Parse(strings.NewReader(s)); err == nil {
			var b strings.Builder
			writeText(&b, doc, false)
			s = b.String()
		}
	}
	return utils.StorableText(strings.Join(strings.Fields(s), " "), MaxText)
}

// cleanLink keeps only absolute http(s) links.
func cleanLink(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > maxLink {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return s
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

var dateLayouts = []string{
	time.RFC3339Nano,
	time.RFC1123Z,
	time.RFC1123,
	"Mon, 2 Jan 2006 15:04:05 -0700",
	"Mon, 2 Jan 2006 15:04:05 MST",
	"Mon, 2 Jan 2006 15:04 -0700",
	"Mon, 2 Jan 2006 15:04 MST",
	"2 Jan 2006 15:04:05 -0700",
	"2 Jan 2006 15:04:05 MST",
	time.RFC822Z,
	time.RFC822,
	"2006-01-02T15:04:05Z0700",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02",
}

// parseDate reads the date styles feeds use, in UTC; zero when unreadable.
func parseDate(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	for _, l := range dateLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

// xnode is a small XML tree: enough to read a feed without a struct per
// format. text holds the element's own text; kids also carry that text, in
// order, as nodes with no name, so deepText keeps mixed content in order.
type xnode struct {
	space, local string
	attrs        []xml.Attr
	text         strings.Builder
	kids         []*xnode
}

func parseXML(body []byte) (*xnode, error) {
	d := xml.NewDecoder(bytes.NewReader(body))
	// Feeds in the wild use HTML entities. No AutoClose: HTML's list holds
	// "link", which RSS uses with text.
	d.Strict = false
	d.Entity = xml.HTMLEntity
	d.CharsetReader = charset.NewReaderLabel
	var root *xnode
	var stack []*xnode
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			if root != nil {
				break // keep what parsed before the damage
			}
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			n := &xnode{space: t.Name.Space, local: t.Name.Local, attrs: t.Attr}
			if len(stack) == 0 {
				if root != nil {
					continue
				}
				root = n
			} else {
				p := stack[len(stack)-1]
				p.kids = append(p.kids, n)
			}
			stack = append(stack, n)
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			if len(stack) > 0 {
				p := stack[len(stack)-1]
				p.text.Write(t)
				chunk := &xnode{}
				chunk.text.Write(t)
				p.kids = append(p.kids, chunk)
			}
		}
	}
	if root == nil {
		return nil, io.ErrUnexpectedEOF
	}
	return root, nil
}

func (n *xnode) match(space, local string) bool {
	return n.local == local && n.space == space
}

func (n *xnode) child(space, local string) *xnode {
	if n == nil {
		return nil
	}
	for _, k := range n.kids {
		if k.match(space, local) {
			return k
		}
	}
	return nil
}

func (n *xnode) children(space, local string) []*xnode {
	var out []*xnode
	for _, k := range n.kids {
		if k.match(space, local) {
			out = append(out, k)
		}
	}
	return out
}

// childText is the text of the first matching child that has any.
func (n *xnode) childText(space, local string) string {
	for _, k := range n.kids {
		if k.match(space, local) {
			if t := strings.TrimSpace(k.text.String()); t != "" {
				return t
			}
		}
	}
	return ""
}

// deepText joins the text of n and everything under it (Atom's type="xhtml").
func (n *xnode) deepText() string {
	if n == nil {
		return ""
	}
	var b strings.Builder
	var walk func(*xnode)
	walk = func(n *xnode) {
		if n.local == "" {
			b.WriteString(n.text.String())
			return
		}
		for _, k := range n.kids {
			walk(k)
		}
	}
	walk(n)
	return b.String()
}

func (n *xnode) attr(space, local string) string {
	for _, a := range n.attrs {
		if a.Name.Local == local && a.Name.Space == space {
			return a.Value
		}
	}
	return ""
}
