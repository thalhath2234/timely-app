package agentmcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	signInTTL     = 15 * time.Minute
	maxSignIns    = 20 // waiting sign-ins per account
	callbackPath  = "/agent/mcp/oauth/callback"
	finishTimeout = 2 * time.Minute
)

// ErrSignIn answers a callback whose state is unknown, used or expired.
var ErrSignIn = errors.New("This sign-in is not waiting any more. Start it again from Settings.")

type pendingSignIn struct {
	uid, name string
	expires   time.Time
}

// signIns holds the OAuth states Timely issued. A state is one-use: the first
// callback takes it out, whatever happens next, and it is bound to the
// account and the server that began it.
type signIns struct {
	now func() time.Time
	mu  sync.Mutex
	m   map[string]pendingSignIn
}

func newSignIns(now func() time.Time) *signIns {
	return &signIns{now: now, m: map[string]pendingSignIn{}}
}

func (g *signIns) add(state string, p pendingSignIn) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	n := 0
	for k, v := range g.m {
		if g.now().After(v.expires) {
			delete(g.m, k)
		} else if v.uid == p.uid {
			n++
		}
	}
	if n >= maxSignIns {
		return invalid("Too many sign-ins are waiting. Finish one first.")
	}
	g.m[state] = p
	return nil
}

// take removes and returns the state's sign-in; false when it is unknown,
// used or expired.
func (g *signIns) take(state string) (pendingSignIn, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p, ok := g.m[state]
	delete(g.m, state)
	if !ok || g.now().After(p.expires) {
		return pendingSignIn{}, false
	}
	return p, true
}

// forget drops the account's waiting sign-ins for a server (a removed or
// changed server must not finish a sign-in begun for the old one).
func (g *signIns) forget(uid, name string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for k, v := range g.m {
		if v.uid == uid && v.name == name {
			delete(g.m, k)
		}
	}
}

// RedirectURI is where the issuer sends the browser back: base (Timely's own
// origin, as the browser reaches the API) plus the callback path.
func RedirectURI(base string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(base))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", invalid("The sign-in address is not valid")
	}
	return strings.TrimRight(u.String(), "/") + callbackPath, nil
}

// SignIn begins an OAuth sign-in at the server and returns the address the
// person opens. base is Timely's origin as the person's browser reaches the
// API (the callback comes back there).
func (s *Service) SignIn(ctx context.Context, uid, name, base string) (authorizeURL string, err error) {
	row, err := s.row(ctx, uid, name)
	if err != nil {
		return "", err
	}
	redirect, err := RedirectURI(base)
	if err != nil {
		return "", err
	}
	envs, _, err := s.secrets(ctx, uid, secretEnv)
	if err != nil {
		return "", err
	}
	p := s.prepare(ctx, row, s.o.HostAllowed(ctx, uid), envs)
	if !p.renders || !isRemote(p.entry) || !signsIn(p.entry) {
		if p.problem != "" {
			return "", invalid("%s", p.problem)
		}
		return "", invalid("This server does not sign in")
	}
	var out struct {
		AuthorizeURL string `json:"authorize_url"`
		State        string `json:"state"`
	}
	if err := s.ask(ctx, uid, "mcp.oauth.begin", map[string]any{"name": name, "entry": p.entry, "redirect_uri": redirect}, &out); err != nil {
		return "", err
	}
	u, perr := url.Parse(out.AuthorizeURL)
	if perr != nil || (u.Scheme != "http" && u.Scheme != "https") || out.State == "" {
		return "", fmt.Errorf("the server's sign-in page is not usable")
	}
	s.signIns.forget(uid, name)
	if err := s.signIns.add(out.State, pendingSignIn{uid: uid, name: name, expires: s.now().Add(signInTTL)}); err != nil {
		return "", err
	}
	return out.AuthorizeURL, nil
}

// Callback receives the browser's redirect: the state picks the account and
// the server that began the sign-in, the account's worker trades the code for
// a token (the worker keeps its files; Timely keeps the durable, sealed copy).
// It returns the server's name. The state works once, whatever the outcome.
func (s *Service) Callback(ctx context.Context, state, code, oauthError string) (string, error) {
	p, ok := s.signIns.take(state)
	if !ok {
		return "", ErrSignIn
	}
	if _, err := s.row(ctx, p.uid, p.name); err != nil {
		return "", ErrSignIn
	}
	if s.o.Workers == nil {
		return p.name, ErrUnavailable
	}
	w, err := s.o.Workers.Requester(ctx, p.uid, false)
	if err != nil || w == nil {
		return p.name, ErrSignIn // the worker that began it is gone: so is its sign-in
	}
	fields := map[string]any{"name": p.name, "state": state}
	if oauthError != "" {
		fields["error"] = oauthError
	} else {
		fields["code"] = code
	}
	ctx, cancel := context.WithTimeout(ctx, finishTimeout)
	defer cancel()
	var out struct {
		Token json.RawMessage `json:"token"`
	}
	if err := s.askWith(ctx, w, "mcp.oauth.finish", fields, &out); err != nil {
		_ = s.db.WithContext(ctx).Model(&Server{}).Where("user_id = ? AND name = ?", p.uid, p.name).
			Updates(map[string]any{"last_error": truncate(err.Error(), 300), "updated_at": s.now()}).Error
		return p.name, err
	}
	if emptyToken(out.Token) {
		return p.name, errors.New("The server answered, but no token came back")
	}
	if err := s.storeToken(ctx, p.uid, p.name, out.Token); err != nil {
		return p.name, err
	}
	_ = s.db.WithContext(ctx).Model(&Server{}).Where("user_id = ? AND name = ?", p.uid, p.name).
		Updates(map[string]any{"last_error": "", "updated_at": s.now()}).Error
	s.changed(ctx, p.uid)
	return p.name, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
