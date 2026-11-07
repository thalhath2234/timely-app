package netguard

import (
	"errors"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestControlPorts(t *testing.T) {
	check := Control("80", "443")
	for _, addr := range []string{
		"127.0.0.1:443",
		"[::ffff:127.0.0.1]:443",
		"[64:ff9b::7f00:1]:443",
		"[2002:7f00:1::1]:443",
		"100.100.1.1:443",
		"93.184.216.34:8080",
		"no-port",
		"example.com:443",
	} {
		if err := check("tcp", addr, nil); !errors.Is(err, ErrBlocked) {
			t.Errorf("%s: got %v, want ErrBlocked", addr, err)
		}
	}
	if err := check("tcp", "93.184.216.34:443", nil); err != nil {
		t.Errorf("public address refused: %v", err)
	}
}

func TestControlAnyPort(t *testing.T) {
	check := Control()
	if err := check("tcp", "93.184.216.34:11434", nil); err != nil {
		t.Errorf("public address on another port refused: %v", err)
	}
	if err := check("tcp", "10.0.0.5:11434", nil); !errors.Is(err, ErrBlocked) {
		t.Errorf("private address allowed: %v", err)
	}
}

func TestPublicAddrRanges(t *testing.T) {
	for _, ip := range []string{"192.0.0.8", "198.18.0.1", "198.19.255.1", "240.0.0.1", "64:ff9b:1::a", "2001:0:4136:e378::1"} {
		if PublicAddr(netip.MustParseAddr(ip)) {
			t.Errorf("%s counted as public", ip)
		}
	}
	for _, ip := range []string{"93.184.216.34", "2606:2800:220:1::1"} {
		if !PublicAddr(netip.MustParseAddr(ip)) {
			t.Errorf("%s counted as private", ip)
		}
	}
}

func TestCheckURL(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://example.com/a":      true,
		"http://example.com:80/":     true,
		"https://example.com:443/":   true,
		"HTTPS://example.com/":       true,
		"file:///etc/passwd":         false,
		"ftp://example.com/":         false,
		"http://user:pw@example.com": false,
		"http://example.com:8080/":   false,
		"http:///path":               false,
		"javascript:alert(1)":        false,
	} {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if got := CheckURL(u) == nil; got != ok {
			t.Errorf("%s: allowed=%v, want %v", raw, got, ok)
		}
	}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func redirectTo(location string) roundTrip {
	return func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "final.example" {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("ok")), Request: r}, nil
		}
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": {location}}, Body: http.NoBody, Request: r}, nil
	}
}

func TestNewClientRedirects(t *testing.T) {
	o := Options{Timeout: time.Second, MaxRedirects: 4, Ports: []string{"80", "443"}}
	client := NewClient(o)
	if tr, ok := client.Transport.(*http.Transport); !ok || tr.Proxy != nil {
		t.Fatal("transport must never use a proxy")
	}

	client.Transport = redirectTo("http://example.com:8080/")
	if _, err := client.Get("https://start.example/"); !errors.Is(err, ErrBlocked) {
		t.Errorf("redirect to port 8080: got %v, want ErrBlocked", err)
	}

	client.Transport = redirectTo("https://final.example/")
	res, err := client.Get("https://start.example/")
	if err != nil {
		t.Fatalf("plain redirect refused: %v", err)
	}
	_ = res.Body.Close()

	client.Transport = redirectTo("https://loop.example/")
	if _, err := client.Get("https://loop.example/"); err == nil || !strings.Contains(err.Error(), "too many redirects") {
		t.Errorf("redirect loop: got %v", err)
	}
}
