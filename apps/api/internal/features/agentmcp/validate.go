package agentmcp

import (
	"context"
	"net"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"timely-api/internal/netguard"
)

// Resolver looks a host name up; *net.Resolver is one. A test gives its own.
type Resolver interface {
	LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error)
}

const lookupTimeout = 4 * time.Second

// Names that mean "on this computer or this network", whatever they resolve to.
var privateSuffixes = []string{".localhost", ".local", ".localdomain", ".internal", ".lan", ".home.arpa", ".intranet", ".corp", ".home"}

// parseRemote checks the shape of a remote server's address: an http or https
// link with a host, no sign-in in the link and no fragment.
func parseRemote(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxURLLen {
		return nil, invalid("Enter the server's address, like https://mcp.example.com/mcp")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return nil, invalid("Use an http or https address, like https://mcp.example.com/mcp")
	}
	if u.User != nil {
		return nil, invalid("Leave the user name and password out of the address")
	}
	if u.Fragment != "" {
		return nil, invalid("Leave the # part out of the address")
	}
	return u, nil
}

// publicProblem answers why the host cannot be a public server, or "" when
// every address it resolves to is on the public internet. The check is
// repeated before each spawn (a name can start resolving somewhere private
// after it was saved); DNS rebinding between this check and Hermes' connect
// stays a residual risk (plan section 14) until Hermes applies url_safety to
// MCP transports.
func publicProblem(ctx context.Context, r Resolver, host string) string {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	const reach = "This address is not on the public internet, so the assistant can't reach it from here."
	if ip, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		if !netguard.PublicAddr(ip) {
			return reach
		}
		return ""
	}
	if host == "localhost" || !strings.Contains(host, ".") {
		return reach
	}
	for _, s := range privateSuffixes {
		if strings.HasSuffix(host, s) {
			return reach
		}
	}
	if r == nil {
		r = net.DefaultResolver
	}
	cctx, cancel := context.WithTimeout(ctx, lookupTimeout)
	defer cancel()
	addrs, err := r.LookupNetIP(cctx, "ip", host)
	if err != nil || len(addrs) == 0 {
		return "Couldn't find " + host + ". Check the address."
	}
	for _, a := range addrs {
		if !netguard.PublicAddr(a) {
			return "This address now points at a private network or this computer."
		}
	}
	return ""
}

// checkRemote validates a remote entry's address: its shape, a sign-in only
// over https, and a public host.
func checkRemote(ctx context.Context, r Resolver, entry map[string]any) (problem string, err error) {
	raw, _ := entry["url"].(string)
	u, err := parseRemote(raw)
	if err != nil {
		return "", err
	}
	if signsIn(entry) && u.Scheme != "https" {
		return "", invalid("A server you sign in to must use https")
	}
	return publicProblem(ctx, r, u.Hostname()), nil
}
