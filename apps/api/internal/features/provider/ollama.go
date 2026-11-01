package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"timely-api/internal/features/chat"
)

// ollamaContext is the context window asked of Ollama. Its OpenAI-compatible
// endpoint cannot set one, and the default (4k on small GPUs) would silently
// cut Timely's system prompt, so Ollama is driven through native /api/chat.
func ollamaContext() int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("OLLAMA_NUM_CTX"))); err == nil && n >= 2048 {
		return n
	}
	return 32768
}

// Ollama talks to Ollama's native /api/chat, locally or on Ollama Cloud.
type Ollama struct {
	Spec   *apiProvider
	Base   string
	Key    string
	Model  string
	Client *http.Client
	// Typed marks an address the person typed (not one the server lists):
	// its answers are never quoted back (see typedFailure).
	Typed bool
}

func (p *Ollama) CanSearch() bool { return false }

func (p *Ollama) Complete(ctx context.Context, messages []chat.WireMessage, tools []any, search bool) (chat.WireMessage, error) {
	if search {
		return chat.WireMessage{}, fmt.Errorf("Web search is not available with %s. Turn web search off for this chat, or choose OpenRouter, Anthropic API, Claude Code or Codex in Settings → Agent", p.Spec.Label)
	}
	return chat.RetryTransient(ctx, func() (chat.WireMessage, error) { return p.completeOnce(ctx, messages, tools) })
}

type ollamaToolCall struct {
	ID       string `json:"id,omitempty"`
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

func (p *Ollama) completeOnce(ctx context.Context, messages []chat.WireMessage, tools []any) (chat.WireMessage, error) {
	var empty chat.WireMessage
	names := map[string]string{} // tool call id → name, for tool results
	wire := make([]any, 0, len(messages))
	for _, m := range messages {
		out := map[string]any{"role": m.Role, "content": m.Content}
		for _, url := range m.ImageURLs {
			if _, data, ok := splitDataURL(url); ok {
				images, _ := out["images"].([]string)
				out["images"] = append(images, data)
			}
		}
		if len(m.ToolCalls) > 0 {
			calls := make([]ollamaToolCall, 0, len(m.ToolCalls))
			for _, tc := range m.ToolCalls {
				names[tc.ID] = tc.Function.Name
				var call ollamaToolCall
				call.ID, call.Function.Name = tc.ID, tc.Function.Name
				call.Function.Arguments = json.RawMessage(tc.Function.Arguments)
				if !json.Valid(call.Function.Arguments) {
					call.Function.Arguments = json.RawMessage("{}")
				}
				calls = append(calls, call)
			}
			out["tool_calls"] = calls
		}
		if m.Role == "tool" {
			out["tool_name"] = names[m.ToolCallID]
			out["tool_call_id"] = m.ToolCallID
		}
		wire = append(wire, out)
	}
	body := map[string]any{"model": p.Model, "messages": wire, "stream": false,
		"options": map[string]any{"num_ctx": ollamaContext(), "num_predict": 8192, "temperature": 0.2}}
	if len(tools) > 0 {
		body["tools"] = tools
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return empty, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, joinURL(p.Base, "api/chat"), bytes.NewReader(raw))
	if err != nil {
		return empty, err
	}
	p.Spec.authorize(req, p.Key)
	req.Header.Set("Content-Type", "application/json")
	res, err := p.Client.Do(req)
	if err != nil {
		if p.Typed {
			return empty, typedFailure(p.Spec.Label, p.Base, 0, err)
		}
		return empty, fmt.Errorf("Could not reach %s at %s: %w", p.Spec.Label, p.Base, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		if p.Typed {
			return empty, typedFailure(p.Spec.Label, p.Base, res.StatusCode, nil)
		}
		return empty, statusError(p.Spec.Label, res)
	}
	var data struct {
		Message struct {
			Content   string           `json:"content"`
			ToolCalls []ollamaToolCall `json:"tool_calls"`
		} `json:"message"`
		DoneReason string `json:"done_reason"`
		Error      string `json:"error"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&data); err != nil {
		if p.Typed {
			return empty, typedFailure(p.Spec.Label, p.Base, 0, nil)
		}
		return empty, fmt.Errorf("%s answer could not be read: %w", p.Spec.Label, err)
	}
	if data.Error != "" {
		if p.Typed {
			return empty, typedFailure(p.Spec.Label, p.Base, 0, nil)
		}
		return empty, fmt.Errorf("%s: %s", p.Spec.Label, clip(data.Error))
	}
	if data.DoneReason == "length" {
		return empty, fmt.Errorf("The proposal was too large; try a smaller request")
	}
	out := chat.WireMessage{Role: "assistant", Content: data.Message.Content}
	for i, call := range data.Message.ToolCalls {
		var tc chat.ToolCall
		tc.ID, tc.Type = call.ID, "function"
		if tc.ID == "" {
			tc.ID = fmt.Sprintf("call_%d", i+1)
		}
		tc.Function.Name = call.Function.Name
		tc.Function.Arguments = "{}"
		if args := bytes.TrimSpace(call.Function.Arguments); len(args) > 0 && string(args) != "null" {
			var asString string
			if json.Unmarshal(args, &asString) == nil {
				tc.Function.Arguments = asString
			} else {
				tc.Function.Arguments = string(args)
			}
		}
		out.ToolCalls = append(out.ToolCalls, tc)
	}
	return out, nil
}

// ollamaModels lists installed (or cloud) models via /api/tags and keeps
// those whose /api/show capabilities include tools; vision is read from the
// same capabilities.
func ollamaModels(ctx context.Context, client *http.Client, spec *apiProvider, base, key string) ([]ModelOption, error) {
	return listOllamaModels(ctx, client, spec, base, key, false)
}

// listOllamaModels is ollamaModels; typed marks an address the person typed,
// whose answers are never quoted back.
func listOllamaModels(ctx context.Context, client *http.Client, spec *apiProvider, base, key string, typed bool) ([]ModelOption, error) {
	get := func(method, path string, body any, out any) error {
		var reader io.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			reader = bytes.NewReader(raw)
		}
		req, err := http.NewRequestWithContext(ctx, method, joinURL(base, path), reader)
		if err != nil {
			return err
		}
		spec.authorize(req, key)
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			if typed {
				return typedFailure(spec.Label, base, 0, err)
			}
			return fmt.Errorf("Could not reach %s at %s: %w", spec.Label, base, err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			if typed {
				return typedFailure(spec.Label, base, res.StatusCode, nil)
			}
			return statusError(spec.Label, res)
		}
		err = json.NewDecoder(io.LimitReader(res.Body, 16<<20)).Decode(out)
		if err != nil && typed {
			return typedFailure(spec.Label, base, 0, nil)
		}
		return err
	}
	var tags struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := get(http.MethodGet, "api/tags", nil, &tags); err != nil {
		return nil, err
	}
	if len(tags.Models) > 80 {
		tags.Models = tags.Models[:80]
	}
	out := make([]ModelOption, len(tags.Models))
	keep := make([]bool, len(tags.Models))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, m := range tags.Models {
		wg.Add(1)
		go func(i int, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var show struct {
				Capabilities []string `json:"capabilities"`
			}
			out[i] = ModelOption{ID: name, Name: name}
			if err := get(http.MethodPost, "api/show", map[string]string{"model": name}, &show); err != nil || len(show.Capabilities) == 0 {
				keep[i] = true // unknown: let the test call decide
				return
			}
			keep[i] = contains(show.Capabilities, "tools")
			out[i].Vision = contains(show.Capabilities, "vision")
			if !keep[i] {
				out[i].Note = "no tool calling"
			}
		}(i, m.Name)
	}
	wg.Wait()
	list := []ModelOption{}
	for i := range out {
		if keep[i] {
			list = append(list, out[i])
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	return list, nil
}

// ---- typed addresses ----

// errPrivateAddress refuses a typed Ollama address that points at this
// server or its private network while the server is open to sign-ups, where
// any stranger's account could use it to reach services that are not theirs.
var errPrivateAddress = errors.New("Anyone can sign up on this server, so Ollama can't use a local or private address. Choose “This server” or “Ollama Cloud” as the endpoint, or enter a public address")

// typedError shows its own words but keeps the cause for errors.Is and
// RetryTransient.
type typedError struct {
	msg string
	err error
}

func (e *typedError) Error() string { return e.msg }
func (e *typedError) Unwrap() error { return e.err }

// typedFailure is what a person sees when an Ollama address they typed
// fails. It never quotes the answer or the network error: the address may
// not be Ollama at all, and what it says is not for Timely to repeat.
func typedFailure(label, base string, status int, err error) error {
	var msg string
	switch {
	case errors.Is(err, errPrivateAddress):
		msg = errPrivateAddress.Error()
	case err != nil:
		msg = fmt.Sprintf("Could not reach %s at %s. Check the address and that %s is running there", label, base, label)
	case status == http.StatusNotFound:
		msg = fmt.Sprintf("%s returned HTTP 404. Check the address and that the model is installed there", base)
	case status != 0:
		msg = fmt.Sprintf("%s returned HTTP %d. Check that this address is an %s server", base, status, label)
	default:
		msg = fmt.Sprintf("%s did not answer like an %s server. Check the address", base, label)
	}
	return &typedError{msg: msg, err: err}
}

// publicAddr reports whether ip is on the public internet: not this machine,
// not a private, shared (CGNAT), link-local or reserved range, and not an
// IPv6 form that wraps one of those.
func publicAddr(ip netip.Addr) bool {
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

// publicOnly is a dialer check run on every connection, after DNS, so a name
// that resolves (or later re-resolves) to a private address is refused too.
func publicOnly(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return errPrivateAddress
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || !publicAddr(ip) {
		return errPrivateAddress
	}
	return nil
}

// publicTransport connects only to public addresses, and never through a
// proxy, which would connect for it past the check.
var publicTransport = func() *http.Transport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = nil
	t.DialContext = (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second, Control: publicOnly}).DialContext
	return t
}()

func noRedirects(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

// typedClient is the HTTP client for an Ollama address the person typed. It
// never follows a redirect, which could lead anywhere, and while the server
// is open to sign-ups it reaches only public addresses.
func (s *Service) typedClient(timeout time.Duration) *http.Client {
	client := &http.Client{Timeout: timeout, CheckRedirect: noRedirects}
	if !s.privateOllama {
		client.Transport = publicTransport
	}
	return client
}

// typedBase reports whether base is an address the person typed rather than
// one the server lists (the provider's endpoints and OLLAMA_BASE_URL).
func (s *Service) typedBase(spec *apiProvider, base string) bool {
	if !spec.CustomURL {
		return false
	}
	base = strings.TrimRight(base, "/")
	for _, e := range spec.Endpoints {
		if base == strings.TrimRight(e.BaseURL, "/") {
			return false
		}
	}
	return base != strings.TrimRight(s.defaultBase(spec), "/")
}
