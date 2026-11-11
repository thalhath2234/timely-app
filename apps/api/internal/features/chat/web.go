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
// text (outside). The worker's gate holds the exfiltration rule; Go repeats
// its page half here as a second line.

// webTools are the Hermes tools the chat's web toggle governs.
var webTools = map[string]bool{"web_search": true, "web_extract": true}

// Answers to the model.
const (
	// webOff is the gate's verdict for a web tool in a chat whose web
	// search is off, a Sensitive chat or an answer-only turn.
	webOff = "Web search is off in this chat"
	// needsSearchKey answers a web_search whose provider has no search of
	// its own (ADR 0009: nothing switches to another provider silently).
	needsSearchKey = "Web search needs a search key in Settings → Agent"
	// pasteLink refuses a page read the exfiltration rule stops (plan 8.1,
	// 12; block in phases 3 and 4).
	pasteLink = "Paste the link yourself if you want me to open it"
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

// hostOf is a link's host as the exfiltration rule compares it: lower case,
// without "www.".
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

// webPage is one page of a web_extract answer.
type webPage struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Error   string `json:"error,omitempty"`
}

// linkPattern finds links a search answer names in its text (Claude Code
// and Codex answer with links, not citations): markdown links first, then
// bare ones.
var (
	markdownLink = regexp.MustCompile(`\[([^\]\n]{1,300})\]\((https?://[^\s)]+)\)`)
	bareLink     = regexp.MustCompile(`https?://[^\s<>()\[\]"'` + "`" + `]+`)
)

// searchResults lists a search answer's sources: the provider's url
// citations, then the links in its text, each address once, at most limit.
func searchResults(answer WireMessage, limit int) []webResult {
	if limit <= 0 || limit > maxResults {
		limit = maxResults
	}
	out := []webResult{}
	seen := map[string]bool{}
	add := func(link, title, description string) {
		link = strings.TrimRight(strings.TrimSpace(link), ".,;:!?")
		if link == "" || seen[link] || len(out) >= limit || hostOf(link) == "" {
			return
		}
		seen[link] = true
		out = append(out, webResult{URL: link, Title: utils.ClipUTF8(strings.TrimSpace(title), 300), Description: utils.ClipUTF8(strings.TrimSpace(description), 500)})
	}
	for _, rawAnnotation := range answer.Annotations {
		var a struct {
			Type     string `json:"type"`
			Citation struct {
				URL     string `json:"url"`
				Title   string `json:"title"`
				Content string `json:"content"`
			} `json:"url_citation"`
		}
		if json.Unmarshal(rawAnnotation, &a) == nil && a.Type == "url_citation" {
			add(a.Citation.URL, a.Citation.Title, a.Citation.Content)
		}
	}
	for _, m := range markdownLink.FindAllStringSubmatch(answer.Content, -1) {
		add(m[2], m[1], "")
	}
	for _, link := range bareLink.FindAllString(answer.Content, -1) {
		add(link, "", "")
	}
	return out
}

// webSearch is the timely backend's web_search: the chat provider's own
// search, within classic's caps (maxSearches a run, maxSearchFailures
// failures). Its sources become pages this run may open after taint.
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
	results := searchResults(answer, in.Limit)
	for _, r := range results {
		run.web.seen(r.URL)
	}
	run.web.read = true
	run.web.taint = append(run.web.taint, TaintSource{Kind: "web", Tool: "web_search"})
	return map[string]any{"answer": answer.Content, "results": results}, true, nil
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
// (public, and after outside text reached the run, one the person typed or
// a search result) and read through the run's PageFetcher.
func (s *Service) webExtract(ctx context.Context, c *Conversation, run *toolRun, args json.RawMessage) (result any, outside bool, err error) {
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
	guard := s.fetchGuard(ctx, c)
	budget := maxExtractText / len(urls)
	pages := []webPage{}
	for _, raw := range urls {
		raw = strings.TrimSpace(raw)
		page := webPage{URL: raw}
		u, err := url.Parse(raw)
		switch {
		case err != nil || publicURL(u) != nil:
			page.Error = notPublic
		case run.tainted() && !run.web.mayOpen(guard, raw):
			// Second line of the exfiltration rule (the worker's gate is the
			// first): outside text could ask for a page whose address
			// carries the person's data.
			page.Error = pasteLink
		default:
			got, err := fetcher(ctx, u.String())
			if err != nil {
				if ctx.Err() != nil {
					return nil, false, ctx.Err()
				}
				page.Error = err.Error()
				break
			}
			page.URL = got.URL
			if page.URL == "" {
				page.URL = u.String()
			}
			page.Title, page.Content = got.Title, utils.StorableText(got.Content, budget)
			run.web.read, outside = true, true
			run.web.taint = append(run.web.taint, TaintSource{Kind: "web", Tool: "web_extract", Host: hostOf(raw)})
		}
		pages = append(pages, page)
	}
	return map[string]any{"pages": pages}, outside, nil
}

// webRun is what an agent run did with the timely web backend.
type webRun struct {
	// on is flags.web for the run: the chat's web toggle, not Sensitive,
	// not answer-only.
	on    bool
	fetch PageFetcher
	// results are the addresses this run's searches returned, and hosts
	// their hosts.
	results, hosts map[string]bool
	// read is set once a search or page brought outside text into the run;
	// taint holds the sources not yet handed to the engine.
	read  bool
	taint []TaintSource
}

func (w *webRun) seen(link string) {
	if w.results == nil {
		w.results, w.hosts = map[string]bool{}, map[string]bool{}
	}
	w.results[link] = true
	if host := hostOf(link); host != "" {
		w.hosts[host] = true
	}
}

// mayOpen is whether a tainted run may read raw: the person typed its site
// (and any query string) or one of their bots reads it, a search of this run
// returned it, or it is a page without a query string on a site a search
// returned.
func (w *webRun) mayOpen(guard *fetchGuard, raw string) bool {
	if guard.allowsURL(raw) || w.results[raw] {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && u.RawQuery == "" && w.hosts[hostOf(raw)]
}

// takeTaint hands over the web sources read since the last call.
func (w *webRun) takeTaint() []TaintSource {
	t := w.taint
	w.taint = nil
	return t
}

// hostWord finds the sites a person's words name: a link's host, or a bare
// name such as example.com.
var hostWord = regexp.MustCompile(`(?i)(?:https?://)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b`)

// hosts is the guard's list as the worker's exfiltration rule reads it
// (run.start person_hosts): the sites the person typed in this chat and the
// sites their bots read.
func (g *fetchGuard) hosts() []string {
	out := []string{}
	add := func(host string) {
		host = strings.TrimPrefix(strings.TrimSuffix(strings.ToLower(host), "."), "www.")
		if host != "" && !slices.Contains(out, host) {
			out = append(out, host)
		}
	}
	for _, m := range hostWord.FindAllStringSubmatch(g.typed, -1) {
		add(m[1])
	}
	for link := range g.known {
		add(hostOf(link))
	}
	slices.Sort(out)
	return out
}
