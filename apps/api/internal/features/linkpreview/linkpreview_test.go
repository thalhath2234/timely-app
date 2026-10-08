package linkpreview

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestParse(t *testing.T) {
	page := `<html><head><title>Plain &amp; title</title>
<meta name="description" content="Fallback">
<meta property="og:title" content="OG   title">
<meta content='OG description' property='og:description'>
<meta property="og:site_name" content="Example"></head></html>`
	title, description, site := Parse(page)
	if title != "OG title" || description != "OG description" || site != "Example" {
		t.Fatalf("got %q %q %q", title, description, site)
	}
	title, description, _ = Parse(`<title>
  Only a title </title><meta name="description" content="Words">`)
	if title != "Only a title" || description != "Words" {
		t.Fatalf("got %q %q", title, description)
	}
}

func TestPublicIP(t *testing.T) {
	for _, addr := range []string{"127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.5.4", "169.254.169.254", "100.100.1.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"} {
		if publicIP(net.ParseIP(addr)) {
			t.Errorf("%s counted as public", addr)
		}
	}
	for _, addr := range []string{"93.184.216.34", "2606:2800:220:1::1"} {
		if !publicIP(net.ParseIP(addr)) {
			t.Errorf("%s counted as private", addr)
		}
	}
}

func TestFetchRefusesLocalServers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<title>secret</title>"))
	}))
	defer server.Close()
	u, _ := url.Parse(server.URL)
	if _, err := New().Fetch(context.Background(), u); err == nil {
		t.Fatal("fetched a loopback address")
	}
	for _, raw := range []string{"file:///etc/passwd", "http://user:pw@example.com/", "http://example.com:8080/"} {
		u, _ := url.Parse(raw)
		if checkURL(u) == nil {
			t.Errorf("%s allowed", raw)
		}
	}
}
