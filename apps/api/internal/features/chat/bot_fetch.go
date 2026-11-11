package chat

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
)

// fetchRefusal is preview_bot's answer for an address the person did not
// give: Timely fetches it the moment it is read, so a page or search result
// could otherwise steer the model into sending the person's data to a site
// of its choosing in an address.
const fetchRefusal = "Timely only reads an address before approval when the person typed its site in this chat or one of their bots already reads it. Do not preview it: propose the bot as it is, and it reads the page once the person approves"

// fetchGuard is which addresses a run may have Timely read before the person
// approves anything: sites the person typed in this conversation, with
// query strings they typed, and the addresses their bots already read.
type fetchGuard struct {
	typed string          // the person's own messages, lower case
	known map[string]bool // addresses the person's bots read
	// run, when set, is the run the read is for: once outside text reached
	// it, only the pages its web rule opens (webRun.mayOpen) are read.
	run *toolRun
}

// runGuard is fetchGuard for a read a run makes: preview_bot, or a proposed
// bot's preview. After taint a page path could carry the person's data as
// it could in web_extract, so the same rule holds (plan 8.1, 12).
func (s *Service) runGuard(ctx context.Context, c *Conversation, run *toolRun) *fetchGuard {
	g := s.fetchGuard(ctx, c)
	g.run = run
	return g
}

func (s *Service) fetchGuard(ctx context.Context, c *Conversation) *fetchGuard {
	g := &fetchGuard{known: map[string]bool{}}
	var typed []string
	for _, m := range c.Messages {
		if m.Role == "user" && m.Continue == "" {
			typed = append(typed, m.Content)
		}
	}
	g.typed = strings.ToLower(strings.Join(typed, "\n"))
	if s.db != nil {
		var urls []string
		// No table yet (a test schema without Bots) only means no bots.
		if s.db.WithContext(ctx).Raw(`SELECT url FROM bot_watches WHERE user_id = ? AND url <> ''`, c.UserID).Scan(&urls).Error == nil {
			for _, u := range urls {
				g.known[strings.ToLower(u)] = true
			}
		}
	}
	return g
}

// allows is whether every page and feed address in watches (preview_bot's
// or a create_bot/update_bot step's) may be read now. A price watch names
// a source, not an address.
func (g *fetchGuard) allows(watches json.RawMessage) bool {
	var ws []struct {
		URL string `json:"url"`
	}
	if json.Unmarshal(watches, &ws) != nil {
		return false
	}
	for _, w := range ws {
		if w.URL != "" && !g.allowsURL(w.URL) {
			return false
		}
	}
	return true
}

func (g *fetchGuard) allowsURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if g.known[strings.ToLower(raw)] {
		return true
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return false
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	if !g.typedHost(host) {
		return false
	}
	// Data rides out in a query string: one the person did not type is
	// not theirs to send.
	if u.RawQuery != "" && !strings.Contains(g.typed, strings.ToLower(u.RawQuery)) {
		return false
	}
	return g.run == nil || !g.run.tainted() || g.run.web.mayOpen(g, raw)
}

// typedHost is whether host appears in the person's words as a whole name:
// "example.com" in "see example.com/p" but not in "notexample.com".
func (g *fetchGuard) typedHost(host string) bool {
	for at := 0; ; {
		i := strings.Index(g.typed[at:], host)
		if i < 0 {
			return false
		}
		start, end := at+i, at+i+len(host)
		before := start == 0 || !hostChar(g.typed[start-1]) ||
			start >= 4 && g.typed[start-4:start] == "www." && (start == 4 || !hostChar(g.typed[start-5]))
		if before && (end == len(g.typed) || !hostChar(g.typed[end]) || g.typed[end] == '.' && (end+1 == len(g.typed) || !hostChar(g.typed[end+1]))) {
			return true
		}
		at = start + 1
	}
}

func hostChar(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= '0' && b <= '9' || b == '-' || b == '.'
}

// previewWatches is the watches a preview_bot call's arguments name.
func previewWatches(args json.RawMessage) json.RawMessage {
	var in struct {
		Watches json.RawMessage `json:"watches"`
	}
	if json.Unmarshal(args, &in) != nil {
		return nil
	}
	return in.Watches
}
