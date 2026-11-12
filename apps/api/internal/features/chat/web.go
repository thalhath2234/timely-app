package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/netguard"
	"timely-api/internal/utils"
)

// The agent engine's side of the worker's timely web backend (plan 8.4, Q-3.8,
// PROTOCOL.md section 10.7). The model calls Hermes' web_search and
// web_extract; with no search key in Settings their backend is timely_web,
// which asks Go through tool.call. Go searches with the chat provider's own
// search (the run's Completer, the same path classic's web_search takes) and
// reads pages through the netguard fetcher. Both results carry third-party
// text (outside): the chat is tainted, so its next proposal is held for
// review (ADR 0007). Timely puts no rule of its own on where a tainted chat
// may search or read (owner decision Q-3.9): Hermes' own handling applies,
// since the answer reaches the model as Hermes' web_search or web_extract
// result (wrapped as untrusted data, threat-scanned, a URL carrying a key or
// token refused before Go is asked).

// webTools are the Hermes tools the chat's web toggle governs.
var webTools = map[string]bool{"web_search": true, "web_extract": true}

// Answers to the model.
const (
	// webOff is the gate's verdict for a web tool in a chat whose web
	// search is off, a Sensitive chat or an answer-only turn.
	webOff = "Web search is off in this chat"
	// needsSearchKey answers a web_search whose provider has no search of
	// its own (ADR 0009: nothing switches to another provider silently).
	// The key is added on the web or desktop app: the phone's Settings has
	// no search key row.
	needsSearchKey = "Web search needs a search key. Add one in Timely on the web or the desktop app, in Settings → Agent → Web search"
	// notPublic refuses an address on this computer or a private network.
	notPublic = "Timely only reads public web pages; that address is on this computer or a private network"
)

// maxExtractURLs is how many pages one web_extract may read, and
// maxExtractText how much page text one answer carries in all, below the
// 90,000-byte result cap.
const (
	maxExtractURLs = 5
	maxExtractText = 60000
	maxResults     = 20
)

// Page is one page web_extract read: its final address, title and readable
// text.
type Page struct {
	URL, Title, Content string
}

// PageFetcher reads one public web page for web_extract. The address has
// already passed publicURL; the fetcher checks every address it connects
// to again.
type PageFetcher func(ctx context.Context, rawURL string) (Page, error)

// NetguardFetcher reads pages with the bots' polite fetcher: public addresses
// only (checked in the dialer after DNS and on every redirect), ports 80 and
// 443, robots.txt, a 5 MB body cap and a 20 s time cap, and keeps the
// page's readable text.
func NetguardFetcher() PageFetcher {
	f := fetch.New(fetch.Config{SiteGap: time.Second, SiteMaxWait: 5 * time.Second})
	return func(ctx context.Context, rawURL string) (Page, error) {
		res, err := f.Get(ctx, fetch.Request{URL: rawURL, Want: fetch.WantPage, MaxWait: 5 * time.Second})
		if err != nil {
			if errors.Is(err, netguard.ErrBlocked) || errors.Is(err, fetch.ErrBlockedAddress) {
				return Page{}, errors.New(notPublic)
			}
			return Page{}, err
		}
		if res.Status >= 400 {
			return Page{}, fmt.Errorf("The page answered with error %d", res.Status)
		}
		return readable(res.FinalURL, res.Body, res.ContentType)
	}
}

// readable is a fetched page as web_extract returns it.
func readable(finalURL string, body []byte, contentType string) (Page, error) {
	text, err := extract.Text(body, contentType)
	if err != nil {
		return Page{}, fmt.Errorf("The page could not be read: %v", err)
	}
	return Page{URL: finalURL, Title: extract.PageTitle(body, contentType), Content: text}, nil
}

// fixtureSuffix names the pages FixtureFetcher serves. .invalid never
// resolves (RFC 2606), so a fixture can never shadow a real site.
const fixtureSuffix = ".fixture.invalid"

var fixtureName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// FixtureFetcher serves https://<name>.fixture.invalid/<path> from
// <dir>/<name>/<path> (index.html for the bare host) and refuses every other
// address. Tests and the verify stack use it; the API wires it only when
// TIMELY_AGENT_WEB_FIXTURES and DB_SCHEMA are both set.
func FixtureFetcher(dir string) PageFetcher {
	return func(_ context.Context, rawURL string) (Page, error) {
		u, err := url.Parse(rawURL)
		if err != nil {
			return Page{}, errors.New("not a fixture page")
		}
		host := strings.ToLower(u.Hostname())
		name, ok := strings.CutSuffix(host, fixtureSuffix)
		if u.Scheme != "https" || !ok || !fixtureName.MatchString(name) {
			return Page{}, errors.New("not a fixture page")
		}
		rel := strings.TrimPrefix(path.Clean("/"+u.Path), "/")
		if rel == "" {
			rel = "index.html"
		}
		file := filepath.Join(dir, name, filepath.FromSlash(rel))
		if !strings.HasPrefix(file, filepath.Clean(dir)+string(filepath.Separator)) {
			return Page{}, errors.New("not a fixture page")
		}
		body, err := os.ReadFile(file)
		if err != nil {
			return Page{}, errors.New("The page answered with error 404")
		}
		contentType := "text/plain; charset=utf-8"
		if ext := strings.ToLower(filepath.Ext(file)); ext == ".html" || ext == ".htm" {
			contentType = "text/html; charset=utf-8"
		}
		return readable(u.String(), body, contentType)
	}
}

// publicURL refuses an address that is not a plain http(s) link on the
// public internet before anything is fetched: an IP address on this machine,
// a private, shared (CGNAT, the tailnet) or reserved range, and names that
// only resolve locally. A name that resolves to such an address is refused
// again by the fetcher's dialer.
func publicURL(u *url.URL) error {
	if u == nil || netguard.CheckURL(u) != nil {
		return errors.New(notPublic)
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if ip, err := netip.ParseAddr(host); err == nil {
		if !netguard.PublicAddr(ip) {
			return errors.New(notPublic)
		}
		return nil
	}
	if !strings.Contains(host, ".") || host == "localhost" {
		return errors.New(notPublic)
	}
	for _, local := range []string{".localhost", ".local", ".internal", ".lan", ".home.arpa", ".ts.net", ".tailscale.net"} {
		if strings.HasSuffix(host, local) {
			return errors.New(notPublic)
		}
	}
	return nil
}

// hostOf is a link's host as a taint source names it: lower case, without
// "www.".
func hostOf(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.TrimSuffix(strings.ToLower(u.Hostname()), "."), "www.")
}

// webResult is one web_search result (PROTOCOL.md section 10.7).
type webResult struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// webPage is one page of a web_extract answer: url is the address asked
// for (the worker matches pages to its request by it), finalURL where the
// page was read when a redirect or Go's encoding of the link changed it.
type webPage struct {
	URL      string `json:"url"`
	FinalURL string `json:"final_url,omitempty"`
	Title    string `json:"title"`
	Content  string `json:"content"`
	Error    string `json:"error,omitempty"`
}

// searchResults lists a search answer's sources: the provider's url
// citations, each address once, at most limit. A link in the answer text is
// not a result: the text is the search model's own writing, and the model
// still reads its links there. Claude Code and Codex cite nothing, so their
// searches return no rows.
func searchResults(answer WireMessage, limit int) []webResult {
	if limit <= 0 || limit > maxResults {
		limit = maxResults
	}
	out := []webResult{}
	seen := map[string]bool{}
	for _, rawAnnotation := range answer.Annotations {
		var a struct {
			Type     string `json:"type"`
			Citation struct {
				URL     string `json:"url"`
				Title   string `json:"title"`
				Content string `json:"content"`
			} `json:"url_citation"`
		}
		if json.Unmarshal(rawAnnotation, &a) != nil || a.Type != "url_citation" {
			continue
		}
		link := strings.TrimRight(strings.TrimSpace(a.Citation.URL), ".,;:!?")
		if link == "" || seen[link] || len(out) >= limit || hostOf(link) == "" {
			continue
		}
		seen[link] = true
		out = append(out, webResult{URL: link, Title: utils.ClipUTF8(strings.TrimSpace(a.Citation.Title), 300), Description: utils.ClipUTF8(strings.TrimSpace(a.Citation.Content), 500)})
	}
	return out
}

// webSearch is the timely backend's web_search: the chat provider's own
// search, within classic's caps (maxSearches a run, maxSearchFailures
// failures).
func (s *Service) webSearch(ctx context.Context, run *toolRun, args json.RawMessage) (result any, outside bool, err error) {
	if !canSearch(ctx) {
		return nil, false, errors.New(needsSearchKey)
	}
	var in struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if json.Unmarshal(args, &in) != nil || len(strings.TrimSpace(in.Query)) == 0 || len(in.Query) >= 2000 {
		return nil, false, errors.New("Invalid search query: write the words to search for")
	}
	answer, err := s.runSearch(ctx, run, strings.TrimSpace(in.Query))
	if err != nil {
		return nil, false, err
	}
	run.web.taint = append(run.web.taint, TaintSource{Kind: "web", Tool: "web_search"})
	return map[string]any{"answer": answer.Content, "results": searchResults(answer, in.Limit)}, true, nil
}

// runSearch makes one provider search, counted against the run's caps; a
// failed one counts towards maxSearchFailures. Only a run whose context ended
// returns the context's error.
func (s *Service) runSearch(ctx context.Context, run *toolRun, query string) (WireMessage, error) {
	if run.searchFailures >= maxSearchFailures {
		return WireMessage{}, errors.New("Web search is not working right now. Answer without it and tell the person the search failed")
	}
	if run.searches >= maxSearches {
		return WireMessage{}, errors.New("That is as many searches as one request may make. Answer from the results above")
	}
	run.searches++
	answer, err := s.complete(ctx, []WireMessage{{Role: "user", Content: query + "\nInclude source links."}}, nil, true)
	if err == nil && strings.TrimSpace(answer.Content) == "" {
		err = errors.New("The search returned no answer")
	}
	if err != nil {
		if ctx.Err() != nil {
			return WireMessage{}, ctx.Err()
		}
		// Each failed search is a paid request, and the provider retries
		// it: after two, later calls get an error without searching.
		run.searchFailures++
	}
	return answer, err
}

// webExtract is the timely backend's web_extract: each address is checked
// (a plain http(s) link on the public internet) and read through the run's
// PageFetcher, once a run: a page the run already read comes from that read.
func (s *Service) webExtract(ctx context.Context, run *toolRun, args json.RawMessage) (result any, outside bool, err error) {
	var in struct {
		URLs []string `json:"urls"`
		URL  string   `json:"url"`
	}
	if json.Unmarshal(args, &in) != nil {
		return nil, false, errors.New("Give the addresses of the pages to read as urls")
	}
	urls := slices.DeleteFunc(append(in.URLs, in.URL), func(u string) bool { return strings.TrimSpace(u) == "" })
	if len(urls) == 0 {
		return nil, false, errors.New("Give the addresses of the pages to read as urls")
	}
	if len(urls) > maxExtractURLs {
		return nil, false, fmt.Errorf("Read at most %d pages at a time", maxExtractURLs)
	}
	fetcher := run.web.fetch
	if fetcher == nil {
		fetcher = NetguardFetcher()
	}
	budget := maxExtractText / len(urls)
	pages := []webPage{}
	for _, raw := range urls {
		raw = strings.TrimSpace(raw)
		page := webPage{URL: raw}
		u, err := url.Parse(raw)
		switch {
		case err != nil || publicURL(u) != nil:
			page.Error = notPublic
		case run.web.pages[pageAddress(raw)].URL != "":
			earlier := run.web.pages[pageAddress(raw)]
			page.FinalURL, page.Title, page.Content = earlier.FinalURL, earlier.Title, earlier.Content
			outside = true
		default:
			got, err := fetcher(ctx, u.String())
			if err != nil {
				if ctx.Err() != nil {
					return nil, false, ctx.Err()
				}
				page.Error = err.Error()
				break
			}
			if got.URL != "" && got.URL != raw {
				page.FinalURL = got.URL
			}
			page.Title, page.Content = got.Title, utils.StorableText(got.Content, budget)
			if run.web.pages == nil {
				run.web.pages = map[string]webPage{}
			}
			run.web.pages[pageAddress(raw)] = page
			outside = true
			run.web.taint = append(run.web.taint, TaintSource{Kind: "web", Tool: "web_extract", Host: hostOf(raw)})
		}
		pages = append(pages, page)
	}
	return map[string]any{"pages": pages}, outside, nil
}

// pageAddress is the key a read page is kept under: the address as asked
// for, a front page with or without its "/" alike (both send "GET /").
func pageAddress(raw string) string {
	if u, err := url.Parse(raw); err == nil && u.Host != "" && u.Path == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" {
		return raw + "/"
	}
	return raw
}

// webRun is what an agent run did with the timely web backend.
type webRun struct {
	// on is flags.web for the run: the chat's web toggle, not Sensitive,
	// not answer-only.
	on    bool
	fetch PageFetcher
	// pages are the pages this run read, by address (pageAddress): a page
	// read again comes from here.
	pages map[string]webPage
	// taint holds the web sources read and not yet handed to the engine.
	taint []TaintSource
}

// takeTaint hands over the web sources read since the last call.
func (w *webRun) takeTaint() []TaintSource {
	t := w.taint
	w.taint = nil
	return t
}
