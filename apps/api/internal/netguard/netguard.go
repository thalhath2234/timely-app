// Package netguard keeps server-side fetches of addresses a person typed on
// the public internet. The address check runs in the dialer, after DNS, on
// every connection and redirect, so a name cannot resolve (or re-resolve) to
// this machine or a private network. Requests never go through a proxy,
// which would connect for us past the check.
package netguard

import (
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"syscall"
	"time"
)

var ErrBlocked = errors.New("this address is not on the public internet")

// PublicAddr reports whether ip is on the public internet: not this machine,
// not a private, shared (CGNAT), link-local or reserved range, and not an
// IPv6 form that wraps one of those.
func PublicAddr(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	for _, p := range nonPublic {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

var nonPublic = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),      // "this network"
	netip.MustParsePrefix("100.64.0.0/10"),  // shared address space (CGNAT, Tailscale)
	netip.MustParsePrefix("192.0.0.0/24"),   // IETF protocol assignments
	netip.MustParsePrefix("198.18.0.0/15"),  // benchmarking
	netip.MustParsePrefix("240.0.0.0/4"),    // reserved and broadcast
	netip.MustParsePrefix("64:ff9b::/96"),   // NAT64 wraps IPv4
	netip.MustParsePrefix("64:ff9b:1::/48"), // local NAT64
	netip.MustParsePrefix("2002::/16"),      // 6to4 wraps IPv4
	netip.MustParsePrefix("2001::/32"),      // Teredo wraps IPv4
}

// CheckURL refuses anything but a plain http or https link on port 80 or 443.
func CheckURL(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("use an http or https link")
	}
	if u.User != nil || u.Hostname() == "" {
		return errors.New("use a plain web link")
	}
	if p := u.Port(); p != "" && p != "80" && p != "443" {
		return ErrBlocked
	}
	return nil
}

// Control is a net.Dialer Control that refuses non-public addresses and, when
// ports are given, any other port. It runs for each address actually dialled.
func Control(ports ...string) func(network, address string, c syscall.RawConn) error {
	return func(_, address string, _ syscall.RawConn) error {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return ErrBlocked
		}
		if len(ports) > 0 && !slices.Contains(ports, port) {
			return ErrBlocked
		}
		ip, err := netip.ParseAddr(host)
		if err != nil || !PublicAddr(ip) {
			return ErrBlocked
		}
		return nil
	}
}

// Options sets up a guarded transport and client. Zero durations mean no
// limit; MaxRedirects 0 follows no redirect.
type Options struct {
	Timeout, DialTimeout, HeaderTimeout time.Duration
	MaxRedirects, MaxIdleConns          int
	Ports                               []string // empty means any port
}

// NewTransport dials only public addresses and never uses a proxy.
func NewTransport(o Options) *http.Transport {
	dialer := &net.Dialer{Timeout: o.DialTimeout, Control: Control(o.Ports...)}
	return &http.Transport{
		Proxy:                 nil,
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   o.DialTimeout,
		ResponseHeaderTimeout: o.HeaderTimeout,
		MaxIdleConns:          o.MaxIdleConns,
		IdleConnTimeout:       30 * time.Second,
	}
}

// NewClient wraps NewTransport and checks every redirect with CheckURL.
func NewClient(o Options) *http.Client {
	return &http.Client{
		Transport: NewTransport(o),
		Timeout:   o.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= o.MaxRedirects {
				return errors.New("too many redirects")
			}
			return CheckURL(req.URL)
		},
	}
}
