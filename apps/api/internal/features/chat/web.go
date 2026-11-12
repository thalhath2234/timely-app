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
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/idna"
	"golang.org/x/net/publicsuffix"
	"golang.org/x/text/unicode/norm"

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
// never a result, in a clean run or a tainted one: the text is the search
// model's own writing from the query and the pages it read, so a page it
// read could have it write an address that carries the query's words (the
// person's data). The model still sees those links in the answer; they
// only never become pages a tainted run may open (plan 8.1, 12). Claude
// Code and Codex cite nothing, so their searches return no rows.
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
// failures). Its sources become pages this run may open after taint.
func (s *Service) webSearch(ctx context.Context, c *Conversation, run *toolRun, args json.RawMessage) (result any, outside bool, err error) {
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
	tainted := run.tainted()
	if tainted {
		if run.web.searchNamesOtherSite(s.fetchGuard(ctx, c), in.Query) != "" {
			// Second line of the worker's rule: the query could have the
			// provider open a page that carries the person's data.
			return nil, false, errors.New(pasteLink)
		}
	}
	answer, err := s.runSearch(ctx, run, strings.TrimSpace(in.Query))
	if err != nil {
		return nil, false, err
	}
	// Only the provider's citations are results (pages a tainted run may
	// open); Claude Code and Codex cite nothing, so their links stay in the
	// answer text only.
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
	prompt := query + "\nInclude source links."
	if run.tainted() {
		// Outside text may have written this query: the provider searches
		// with its words and opens no page (WithSearchOnly: Codex's cached
		// search, OpenRouter's Exa engine), so an address the gate missed
		// is never fetched. The prompt line only asks; the setting holds.
		ctx = WithSearchOnly(ctx)
		prompt += "\nSearch the web for these words. Do not open, fetch or visit any address written above."
	}
	answer, err := s.complete(ctx, []WireMessage{{Role: "user", Content: prompt}}, nil, true)
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
			if got.URL != "" && got.URL != raw {
				page.FinalURL = got.URL
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

// mayOpen is whether a tainted run may read raw: one of their bots reads
// it, a search of this run returned it word for word, the person typed it
// (its site and path, and any query string), or it is the front page of a
// site the person typed or a search returned. Any other path or query could
// carry the person's data to the site (plan 8.1, 12).
func (w *webRun) mayOpen(guard *fetchGuard, raw string) bool {
	raw = strings.TrimSpace(raw)
	if w.results[raw] || guard.known[strings.ToLower(raw)] {
		return true
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return false
	}
	host := hostOf(raw)
	typed := guard.typedHost(host)
	if !typed && !w.hosts[host] {
		return false
	}
	if u.RawQuery != "" && !(typed && strings.Contains(guard.typed, strings.ToLower(u.RawQuery))) {
		return false
	}
	if p := strings.TrimSuffix(u.EscapedPath(), "/"); p == "" {
		return true
	}
	return typed && (strings.Contains(guard.typed, strings.ToLower(host+u.EscapedPath())) ||
		strings.Contains(guard.typed, strings.ToLower(host+u.Path)))
}

// searchNamesOtherSite is the first site a tainted run's search query names
// (a link, site:host, or a name with a port, path, query or fragment) that
// the person did not type and no search of this run returned, or that names
// a page on an allowed site that mayOpen would not open: a provider's own
// search may open what a query names (Codex searches live), so a query is a
// page read too. The query is read as a fetcher would (searchText). "" when
// there is none.
func (w *webRun) searchNamesOtherSite(guard *fetchGuard, query string) string {
	query = searchText(query)
	allowed := func(host string) bool {
		return host != "" && (guard.typedHost(host) || w.hosts[host] || guard.typedHost(unicodeHost(host)))
	}
	for _, ip := range ipLiterals(query) {
		if !allowed(ip) {
			return ip
		}
	}
	for _, m := range hostRef.FindAllStringSubmatch(query, -1) {
		host := asciiHost(m[1] + m[2])
		if host != "" && !allowed(host) {
			return host
		}
	}
	for _, name := range bareSites(query) {
		if host := asciiHost(name); host != "" && !allowed(host) {
			return host
		}
	}
	for _, page := range queryPages(query) {
		if host := w.pageBlocked(guard, page); host != "" {
			return host
		}
	}
	return ""
}

// pageBlocked is the site of a page a tainted run's query names when the
// run's page rule would not open it (an address a fetcher could read
// differently, a site the person did not type and no search returned, or a
// path or query that is not the front page, a typed link, a bot's page or a
// search result), else "".
func (w *webRun) pageBlocked(guard *fetchGuard, page string) string {
	raw := page
	switch {
	case strings.HasPrefix(raw, "//"):
		raw = "https:" + raw
	case !strings.Contains(raw, "://"):
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	host := ""
	if err == nil {
		host = asciiHost(u.Hostname())
	}
	if host == "" {
		return "another site"
	}
	authority, _, _ := strings.Cut(raw[strings.Index(raw, "://")+3:], "/")
	authority, _, _ = strings.Cut(authority, "?")
	authority, _, _ = strings.Cut(authority, "#")
	scheme := strings.ToLower(u.Scheme)
	if (scheme != "http" && scheme != "https") || strings.ContainsAny(authority, "@%\\") ||
		(u.Port() != "" && u.Port() != map[string]string{"http": "80", "https": "443"}[scheme]) {
		return host
	}
	if !guard.typedHost(host) && !w.hosts[host] && !guard.typedHost(unicodeHost(host)) {
		return host
	}
	key := pageKey(raw)
	for result := range w.results {
		if pageKey(result) == key {
			return ""
		}
	}
	// mayOpen ignores a fragment (a fetch never sends it); a model reading
	// the query does not, so a fragment must be typed as written.
	if u.Fragment == "" && w.mayOpen(guard, raw) || u.Fragment != "" && strings.Contains(guard.typed, key) {
		return ""
	}
	return host
}

// pageKey is a page's address as the rule compares it (the worker's
// egress.page_key): lower case, no scheme or "www.", the path without a
// trailing "/", then any query and fragment.
func pageKey(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	out := asciiHost(u.Hostname()) + strings.TrimSuffix(u.EscapedPath(), "/")
	if u.RawQuery != "" {
		out += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		out += "#" + u.EscapedFragment()
	}
	return strings.ToLower(out)
}

// asciiHost is a host as the rule compares it: IDNA (an IDN in its xn--
// form), lower case, without a trailing dot or "www.".
func asciiHost(host string) string {
	host = strings.TrimSuffix(strings.ToLower(strings.Trim(host, "[]")), ".")
	if a, err := idna.Lookup.ToASCII(host); err == nil && a != "" {
		host = a
	}
	return strings.TrimPrefix(host, "www.")
}

// unicodeHost is an xn-- host as the person would type it.
func unicodeHost(host string) string {
	if u, err := idna.Lookup.ToUnicode(host); err == nil {
		return u
	}
	return host
}

// searchText is a search query as a fetcher or a model reads its addresses
// (the worker's egress.query_text): NFKC, the ideographic and full-width
// dots, and the "[.]", "(.)" and " dot " spellings people use to hide a
// link, as a dot.
func searchText(query string) string {
	query = strings.NewReplacer("\u3002", ".", "\uff0e", ".", "\uff61", ".").Replace(norm.NFKC.String(query))
	query = dotMark.ReplaceAllString(query, ".")
	for range 8 {
		next := dotWord.ReplaceAllString(query, "${1}.${2}")
		if next == query {
			break
		}
		query = next
	}
	return query
}

var (
	dotMark = regexp.MustCompile(`(?i)\s*(?:\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)|\{dot\})\s*`)
	dotWord = regexp.MustCompile(`(?i)([\p{L}\p{N}_])\s+dot\s+([\p{L}\p{N}_])`)
)

// queryPages are the pages a search query names: links (with any user name
// in them), and bare names or IP addresses with a port, a path, or a query
// or fragment with something in it, trailing punctuation dropped.
func queryPages(query string) []string {
	out := []string{}
	for _, m := range pageRef.FindAllStringSubmatch(query, -1) {
		if page := strings.TrimRight(m[1]+m[2], ".,;:!?)]}"); page != "" {
			out = append(out, page)
		}
	}
	return out
}

// A name is Unicode (an IDN), compared in its IDNA form. Go's \b knows only
// ASCII, so a name starts after a character that is not a letter, digit
// or "_".
const (
	nameRE  = `(?:[\p{L}\p{N}](?:[\p{L}\p{N}_-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,24}|xn--[a-z0-9-]{1,59})`
	afterRE = `(?::\d|/|[?#][^\s?#])`
	tailRE  = `(?::\d+(?:[/?#][^\s"'<>]*)?|/[^\s"'<>]*|[?#][^\s"'<>?#][^\s"'<>]*)`
)

// hostRef finds the sites a search query names so that a search could open
// them, as the worker's egress.query_hosts does.
var hostRef = regexp.MustCompile(`(?i)(?:[a-z][a-z0-9+.-]*://|//|\bsite:)(` + nameRE + `)|(?:^|[^\p{L}\p{N}_])(` + nameRE + `)` + afterRE)

// bareName finds a name written on its own ("evil.com", "<data>.evil.com");
// bareSites keeps those that are sites.
var bareName = regexp.MustCompile(`(?:^|[^\p{L}\p{N}_-])(` + nameRE + `)`)

// reservedTLDs are the last labels kept for tests and private networks
// (RFC 2606, 6761): no public suffix, but a site to a resolver that knows
// them. The worker's tlds.RESERVED lists the same.
var reservedTLDs = map[string]bool{"example": true, "test": true, "invalid": true, "localhost": true, "local": true, "onion": true, "internal": true}

// bareSites are the bare names a query writes whose last label is an ICANN
// top-level domain or a reserved one (the worker's egress.site_name): a
// provider's own search could open "evil.com" with the person's data
// written apart from it or in a DNS label. "node.js" and "config.yaml" stay
// words.
func bareSites(query string) []string {
	out := []string{}
	for _, m := range bareName.FindAllStringSubmatchIndex(query, -1) {
		name := query[m[2]:m[3]]
		if next, _ := utf8.DecodeRuneInString(query[m[3]:]); next == '_' || next == '-' || unicode.IsLetter(next) || unicode.IsDigit(next) {
			continue // part of a longer word
		}
		if siteName(name) {
			out = append(out, name)
		}
	}
	return out
}

// siteName reports whether a bare name's last label (IDNA) is an ICANN
// top-level domain or a reserved one.
func siteName(name string) bool {
	host := asciiHost(name)
	tld := host[strings.LastIndex(host, ".")+1:]
	if reservedTLDs[tld] {
		return true
	}
	suffix, icann := publicsuffix.PublicSuffix(tld)
	return icann && suffix == tld
}

// pageRef finds the pages a search query names, as the worker's
// egress.query_pages does: a link, or a bare name or IP address.
var pageRef = regexp.MustCompile(`(?i)((?:[a-z][a-z0-9+.-]*:)?//[^\s/?#"'<>]+` + tailRE + `?)|(?:^|[^\p{L}\p{N}_.-])((?:` + nameRE + `|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])` + tailRE + `)`)

// ipCandidate finds what could be an IP address in a query: digits and dots,
// or hex digits and colons, bracketed or not.
var ipCandidate = regexp.MustCompile(`(?i)\[?[0-9a-f:.]*[.:][0-9a-f:.]*\]?`)

// ipLiterals are the IP addresses a query names anywhere, normalised: an
// address is a site whether or not a scheme or path goes with it, so a query
// that splits a link around one ("http:// 203.0.113.5 /c?d=...") still names
// it.
func ipLiterals(query string) []string {
	out := []string{}
	for _, m := range ipCandidate.FindAllString(query, -1) {
		bracketed := strings.HasPrefix(m, "[") && strings.HasSuffix(m, "]")
		m = strings.Trim(strings.Trim(m, "[]"), ".")
		hex := len(m) - strings.Count(m, ":") - strings.Count(m, ".")
		ip, err := netip.ParseAddr(m)
		// "std::vector" holds "d::", an address by syntax only: a bare IPv6
		// address needs two colons and four digits.
		if err == nil && (ip.Is4() && strings.Count(m, ".") == 3 || ip.Is6() && (bracketed || strings.Count(m, ":") >= 2 && hex >= 4)) {
			if s := ip.String(); !slices.Contains(out, s) {
				out = append(out, s)
			}
		}
	}
	return out
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

// linkWord finds the links a person's words name with a path, query or
// fragment (a front page needs none: the rule allows it on any allowed site).
var linkWord = regexp.MustCompile(`(?i)(?:https?://)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?::\d+)?([/?#][^\s"'<>()\[\]{}]*)`)

// links is the guard's list of pages as the worker's exfiltration rule
// reads them (run.start person_links): the links the person typed in this
// chat, lower case and without a scheme, and the addresses their bots read.
// After taint the worker opens a page with a path or query only when the
// person typed it, a search returned it, or it is a site's front page; this
// is mayOpen's rule, applied the same way to every web backend.
func (g *fetchGuard) links() []string {
	out := []string{}
	add := func(link string) {
		link = strings.TrimRight(link, ".,;:!?")
		if link != "" && !slices.Contains(out, link) {
			out = append(out, link)
		}
	}
	for _, m := range linkWord.FindAllStringSubmatch(g.typed, -1) {
		add(strings.ToLower(m[1]) + m[2])
	}
	for link := range g.known {
		add(link)
	}
	slices.Sort(out)
	return out
}

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
