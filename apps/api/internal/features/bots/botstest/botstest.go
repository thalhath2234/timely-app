// Package botstest is a fake network for tests that run Bots: checks,
// previews and the chat tools that read pages, with no request ever leaving
// the process. Give the fetcher to bots.Service.SetFetcher.
package botstest

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"timely-api/internal/features/bots/fetch"
)

// Response is one canned answer. Status 0 is 200 and an empty ContentType
// is text/html. Err, when set, fails the request instead, as a broken
// connection would.
type Response struct {
	Status      int
	ContentType string
	Body        string
	Header      http.Header
	Err         error
}

// Page is a 200 HTML answer.
func Page(body string) Response { return Response{Body: body} }

// JSON is a 200 JSON answer.
func JSON(body string) Response { return Response{ContentType: "application/json", Body: body} }

// Feed is a 200 RSS answer.
func Feed(body string) Response { return Response{ContentType: "application/rss+xml", Body: body} }

// Network answers by URL: the full URL with its query first, then the URL
// without its query. Anything else, robots.txt included, is a 404, which
// robots rules read as "everything allowed".
type Network struct {
	mu      sync.Mutex
	replies map[string]Response
	hits    map[string]int
}

// NewNetwork serves replies, keyed by URL.
func NewNetwork(replies map[string]Response) *Network {
	n := &Network{replies: map[string]Response{}, hits: map[string]int{}}
	for u, r := range replies {
		n.replies[u] = r
	}
	return n
}

// Net is a fetcher on a new Network serving replies.
func Net(replies map[string]Response) *fetch.Fetcher { return NewNetwork(replies).Fetcher() }

// Set serves r at rawURL from now on.
func (n *Network) Set(rawURL string, r Response) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.replies[rawURL] = r
}

// Hits counts the requests for rawURL so far.
func (n *Network) Hits(rawURL string) int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.hits[rawURL]
}

// Fetcher reads through the Network: no site spacing, no robots.txt cache
// and no sleeping, so tests run at once.
func (n *Network) Fetcher() *fetch.Fetcher {
	return fetch.New(fetch.Config{
		Client: &http.Client{Transport: n, Timeout: 5 * time.Second},
		Sleep:  func(context.Context, time.Duration) error { return nil },
	})
}

// RoundTrip answers one request.
func (n *Network) RoundTrip(req *http.Request) (*http.Response, error) {
	full := req.URL.String()
	bare := *req.URL
	bare.RawQuery, bare.Fragment = "", ""
	n.mu.Lock()
	r, ok := n.replies[full]
	key := full
	if !ok {
		r, ok = n.replies[bare.String()]
		key = bare.String()
	}
	n.hits[key]++
	n.mu.Unlock()
	if !ok {
		r = Response{Status: http.StatusNotFound, ContentType: "text/plain", Body: "not found"}
	}
	if r.Err != nil {
		return nil, r.Err
	}
	status, ct := r.Status, r.ContentType
	if status == 0 {
		status = http.StatusOK
	}
	if ct == "" {
		ct = "text/html; charset=utf-8"
	}
	h := http.Header{}
	for k, vs := range r.Header {
		h[k] = append([]string(nil), vs...)
	}
	h.Set("Content-Type", ct)
	return &http.Response{
		StatusCode: status, Header: h, Body: io.NopCloser(strings.NewReader(r.Body)),
		ContentLength: int64(len(r.Body)), Request: req,
	}, nil
}
