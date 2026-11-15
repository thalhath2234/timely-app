package agentmcp

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Limits on what a person (or a catalog entry) may store.
const (
	maxEntryBytes  = 8 << 10
	maxArgs        = 32
	maxArgBytes    = 1024
	maxEnv         = 32
	maxEnvBytes    = 4096
	maxServers     = 50
	maxNameLen     = 48
	maxURLLen      = 2048
	maxCommandLen  = 1024
	maxTokenBytes  = 256 << 10
	maxFieldValues = 8
)

// ErrInvalid marks input the person can fix; its text is shown to them.
var ErrInvalid = errors.New("invalid MCP server")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// Message is an ErrInvalid's text without the prefix.
func Message(err error) string {
	return strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": ")
}

var (
	nameRe   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$`)
	envNameR = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)
	refRe    = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)
)

// The keys an entry may carry. The worker's mcp_admin refuses anything else
// too; a key Hermes reads that is not here (headers, cwd, sampling) is a
// way to hand a server something the person did not see on the card.
var (
	urlKeys     = setOf("url", "auth", "oauth", "tools", "enabled", "timeout", "connect_timeout", "sse_read_timeout")
	oauthKeys   = setOf("client_id", "client_secret", "redirect_host", "redirect_port", "redirect_uri", "scope", "timeout")
	commandKeys = setOf("command", "args", "env", "tools", "enabled", "timeout", "connect_timeout")
)

func setOf(keys ...string) map[string]bool {
	m := make(map[string]bool, len(keys))
	for _, k := range keys {
		m[k] = true
	}
	return m
}

// entryMap decodes an entry; numbers stay json.Number so a hash does not
// turn 30 into 30.0.
func entryMap(raw json.RawMessage) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil || m == nil {
		return nil, invalid("the entry is not an object")
	}
	return m, nil
}

func isCommand(entry map[string]any) bool { s, _ := entry["command"].(string); return s != "" }

func isRemote(entry map[string]any) bool {
	s, _ := entry["url"].(string)
	return s != "" && !isCommand(entry)
}

// signsIn reports whether the entry asks the server for an OAuth sign-in.
func signsIn(entry map[string]any) bool { a, _ := entry["auth"].(string); return a == "oauth" }

// cleanEntry checks an entry against the whitelist and the size limits and
// returns it as stored. It does not look at the network.
func cleanEntry(entry map[string]any) (map[string]any, error) {
	if len(entry) == 0 {
		return nil, invalid("the entry is empty")
	}
	out := make(map[string]any, len(entry))
	switch {
	case isCommand(entry):
		for k, v := range entry {
			if !commandKeys[k] {
				return nil, invalid("%q is not allowed in a command server", k)
			}
			out[k] = v
		}
		cmd, _ := entry["command"].(string)
		if len(cmd) > maxCommandLen || strings.ContainsAny(cmd, "\x00\r\n") {
			return nil, invalid("the command is not valid")
		}
		if args, ok := entry["args"]; ok {
			list, ok := args.([]any)
			if !ok || len(list) > maxArgs {
				return nil, invalid("args must be a list of up to %d strings", maxArgs)
			}
			for _, a := range list {
				s, ok := a.(string)
				if !ok || len(s) > maxArgBytes || strings.ContainsRune(s, 0) {
					return nil, invalid("args must be a list of strings")
				}
			}
		}
		if env, ok := entry["env"]; ok {
			m, ok := env.(map[string]any)
			if !ok || len(m) > maxEnv {
				return nil, invalid("env must name up to %d variables", maxEnv)
			}
			for k, v := range m {
				s, ok := v.(string)
				if !envNameR.MatchString(k) || !ok || len(s) > maxEnvBytes {
					return nil, invalid("env %q is not valid", k)
				}
			}
		}
	case isRemote(entry):
		for k, v := range entry {
			if !urlKeys[k] {
				return nil, invalid("%q is not allowed in a remote server", k)
			}
			out[k] = v
		}
		if s, _ := entry["url"].(string); len(s) > maxURLLen {
			return nil, invalid("the address is too long")
		}
		if a, ok := entry["auth"]; ok && a != "oauth" {
			return nil, invalid("auth can only be oauth")
		}
		if o, ok := entry["oauth"]; ok {
			m, ok := o.(map[string]any)
			if !ok {
				return nil, invalid("oauth must be an object")
			}
			for k := range m {
				if !oauthKeys[k] {
					return nil, invalid("oauth %q is not supported", k)
				}
			}
		}
	default:
		return nil, invalid("the entry needs a url or a command")
	}
	for _, k := range []string{"timeout", "connect_timeout", "sse_read_timeout"} {
		if v, ok := out[k]; ok {
			n, ok := v.(json.Number)
			if _, err := strconv.ParseInt(string(n), 10, 32); !ok || err != nil {
				return nil, invalid("%s must be a whole number of seconds", k)
			}
		}
	}
	if e, ok := out["enabled"]; ok {
		if _, ok := e.(bool); !ok {
			return nil, invalid("enabled must be true or false")
		}
	}
	if b, _ := json.Marshal(out); len(b) > maxEntryBytes {
		return nil, invalid("the entry is too large")
	}
	return out, nil
}

// refs lists the ${VAR} names an entry mentions, sorted.
func refs(v any) []string {
	seen := map[string]bool{}
	var walk func(any)
	walk = func(x any) {
		switch t := x.(type) {
		case string:
			for _, m := range refRe.FindAllStringSubmatch(t, -1) {
				seen[m[1]] = true
			}
		case map[string]any:
			for _, e := range t {
				walk(e)
			}
		case []any:
			for _, e := range t {
				walk(e)
			}
		}
	}
	walk(v)
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// fill replaces ${VAR} in every string of v from values; a name with no value
// is left alone and reported.
func fill(v any, values map[string]string) (any, []string) {
	var missing []string
	var walk func(any) any
	walk = func(x any) any {
		switch t := x.(type) {
		case string:
			return refRe.ReplaceAllStringFunc(t, func(m string) string {
				name := m[2 : len(m)-1]
				if val, ok := values[name]; ok {
					return val
				}
				missing = append(missing, name)
				return m
			})
		case map[string]any:
			out := make(map[string]any, len(t))
			for k, e := range t {
				out[k] = walk(e)
			}
			return out
		case []any:
			out := make([]any, len(t))
			for i, e := range t {
				out[i] = walk(e)
			}
			return out
		}
		return x
	}
	out := walk(v)
	sort.Strings(missing)
	return out, missing
}

// entryHash is the worker's mcp_entry_hash: sha256 of the entry's canonical JSON
// (sorted keys, no spaces, non-ASCII as \uXXXX, as Python's json.dumps writes
// it). The worker keeps a command server only when this value is among the
// approved hashes, so the two must agree byte for byte.
func entryHash(entry map[string]any) string {
	var b bytes.Buffer
	writeCanonical(&b, entry)
	sum := sha256.Sum256(b.Bytes())
	return hex.EncodeToString(sum[:])
}

func writeCanonical(b *bytes.Buffer, v any) {
	switch t := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if t {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case json.Number:
		b.WriteString(string(t))
	case string:
		writeCanonicalString(b, t)
	case []any:
		b.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			writeCanonical(b, e)
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys) // by code point, as Python sorts str keys (UTF-8 byte order is the same)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeCanonicalString(b, k)
			b.WriteByte(':')
			writeCanonical(b, t[k])
		}
		b.WriteByte('}')
	default:
		raw, _ := json.Marshal(t)
		b.Write(raw)
	}
}

func writeCanonicalString(b *bytes.Buffer, s string) {
	b.WriteByte('"')
	for len(s) > 0 {
		r, n := utf8.DecodeRuneInString(s)
		s = s[n:]
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r >= ' ' && r <= '~':
			b.WriteRune(r)
		case r > 0xFFFF:
			r -= 0x10000
			fmt.Fprintf(b, `\u%04x\u%04x`, 0xD800+(r>>10), 0xDC00+(r&0x3FF))
		default:
			fmt.Fprintf(b, `\u%04x`, r)
		}
	}
	b.WriteByte('"')
}

// hostOf is the entry's server host for display and for Classify.
func hostOf(entry map[string]any) string {
	raw, _ := entry["url"].(string)
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Hostname()
}
