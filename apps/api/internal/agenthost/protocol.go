package agenthost

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ProtocolVersion is the pipe protocol version sent in hello.
const ProtocolVersion = 1

// MaxLineBytes caps one protocol line. run.start can carry image data, so the
// cap is generous; a longer line means a broken or hostile worker.
const MaxLineBytes = 32 << 20

// Message types the supervisor itself sends or consumes. The other types in
// plan section 5.1 pass through untouched.
const (
	TypeHello     = "hello"
	TypeReady     = "ready"
	TypePing      = "ping"
	TypePong      = "pong"
	TypeHeartbeat = "heartbeat"
	TypeLog       = "log"
	TypeError     = "error"
	TypeShutdown  = "shutdown"
	TypeRunStart  = "run.start"
	TypeRunDone   = "run.done"
	TypeBotRun    = "bot.run"
	TypeBotDone   = "bot.done"

	TypeToolCall    = "tool.call"
	TypeToolResult  = "tool.result"
	TypeGateAsk     = "gate.ask"
	TypeGateVerdict = "gate.verdict"

	TypeRunStop        = "run.stop"
	TypeRunSteer       = "run.steer"
	TypeApprovalAnswer = "approval.answer"
)

// allowedWhileStopping are the messages Go still writes during a graceful
// stop: shutdown itself, and what lets a live run finish its turn (answers to
// the worker's requests, and controls of runs already live). New work
// (run.start, bot.run, session.delete, ...) is refused with ErrWorkerStopping.
var allowedWhileStopping = map[string]bool{
	TypeShutdown: true, TypeToolResult: true, TypeGateVerdict: true,
	TypeRunStop: true, TypeRunSteer: true, TypeApprovalAnswer: true,
}

// goIDPrefix marks request ids Go creates, so a worker request can never be
// mistaken for the reply to one of Go's.
const goIDPrefix = "go-"

var (
	errLineTooLong = errors.New("protocol line too long")
	// ErrProtocol is a malformed line or a message for another account.
	ErrProtocol = errors.New("agent worker broke the protocol")
)

// Message is one line from the worker. Type, ID, Account and Run are lifted
// out; Raw keeps the whole object for Decode.
type Message struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Account string          `json:"account"`
	Run     string          `json:"run,omitempty"`
	Raw     json.RawMessage `json:"-"`
}

// Decode unmarshals the whole message into v.
func (m Message) Decode(v any) error { return json.Unmarshal(m.Raw, v) }

// Busy is the worker's own report of work Go cannot see: background learning
// passes and tracked child processes (plan 6.2), plus its live runs.
type Busy struct {
	Runs     int
	Learning bool
	Children int
}

func (b Busy) any() bool { return b.Runs > 0 || b.Learning || b.Children > 0 }

// SelfTest is ready.self_test (plan 5.1): the worker refuses to serve when a
// check fails, and Go reports the failures.
type SelfTest struct {
	OK       bool        `json:"ok"`
	Failures []string    `json:"failures,omitempty"`
	Checks   []SelfCheck `json:"checks,omitempty"`
}

// SelfCheck is one self-test check.
type SelfCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

// failures lists the failed checks as "name: detail": the worker's own list,
// or else the failed entries of checks.
func (t SelfTest) failures() string {
	if len(t.Failures) > 0 {
		return strings.Join(t.Failures, "; ")
	}
	var out []string
	for _, c := range t.Checks {
		if !c.OK {
			if c.Detail != "" {
				out = append(out, c.Name+": "+c.Detail)
			} else {
				out = append(out, c.Name)
			}
		}
	}
	if len(out) == 0 {
		return "no reason given"
	}
	return strings.Join(out, "; ")
}

// Ready is the worker's answer to hello.
type Ready struct {
	Protocol      int      `json:"protocol,omitempty"`
	HermesTag     string   `json:"hermes_tag"`
	Tools         []string `json:"tools"`
	PluginsLoaded []string `json:"plugins_loaded"`
	SelfTest      SelfTest `json:"self_test"`
	// PID is the interpreter's own process id. On Windows the spawned
	// program can be a venv launcher that starts the interpreter as its
	// child, so Go checks this pid, not its own child's, is inside the
	// worker's Job Object (process group on Unix).
	PID int `json:"pid,omitempty"`
}

type helloFields struct {
	Protocol       int             `json:"protocol"`
	Home           string          `json:"home"`
	SettingsHash   string          `json:"settings_hash"`
	Settings       json.RawMessage `json:"settings,omitempty"`
	CatalogVersion string          `json:"catalog_version,omitempty"`
	// Prepare's answer (PrepareResult): the worker's canary renders the
	// managed floors from these and refuses a managed file that differs.
	TimelySkillsDir   string `json:"timely_skills_dir,omitempty"`
	BrowserExecutable string `json:"browser_executable"`
	ManagedSHA256     string `json:"managed_sha256,omitempty"`
}

type logFields struct {
	Level string `json:"level"`
	Text  string `json:"text"`
}

type errorFields struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}

// parseBusy reads a heartbeat or pong: busy {runs, learning, children}
// (PROTOCOL.md section 5). runs may be a count or a list of run ids, and the
// fields are also accepted at the top level.
// ok is false when the message reports none of them.
func parseBusy(m Message) (Busy, bool) {
	var outer struct {
		Busy json.RawMessage `json:"busy"`
	}
	raw := []byte(m.Raw)
	seen := false
	if json.Unmarshal(raw, &outer) == nil && len(outer.Busy) > 0 && outer.Busy[0] == '{' {
		raw, seen = outer.Busy, true // a busy object is a full report, even when empty
	}
	var body struct {
		Runs     json.RawMessage `json:"runs"`
		Learning *bool           `json:"learning"`
		Children *int            `json:"children"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return Busy{}, false
	}
	var b Busy
	if len(body.Runs) > 0 {
		var ids []json.RawMessage
		var n int
		if json.Unmarshal(body.Runs, &ids) == nil {
			b.Runs, seen = len(ids), true
		} else if json.Unmarshal(body.Runs, &n) == nil {
			b.Runs, seen = n, true
		}
	}
	if body.Learning != nil {
		b.Learning, seen = *body.Learning, true
	}
	if body.Children != nil {
		b.Children, seen = *body.Children, true
	}
	return b, seen
}

// parseLine decodes one protocol line and checks the envelope.
func parseLine(line []byte, account string) (Message, error) {
	var m Message
	if err := json.Unmarshal(line, &m); err != nil {
		return Message{}, fmt.Errorf("%w: not a JSON object: %v", ErrProtocol, err)
	}
	if m.Type == "" {
		return Message{}, fmt.Errorf("%w: message without type", ErrProtocol)
	}
	// An error the worker sends before it has pinned its account (a refused
	// environment, a rejected hello) carries no account. It is only logged
	// or fails the request it answers; it never reaches the handler.
	if m.Account != account && !(m.Type == TypeError && m.Account == "") {
		return Message{}, fmt.Errorf("%w: %s message for another account", ErrProtocol, m.Type)
	}
	m.Raw = append(json.RawMessage(nil), line...)
	return m, nil
}

// encode builds one protocol line: fields (nil, a map or a struct that
// marshals to an object) plus type, id and account.
func encode(typ, id, account string, fields any) ([]byte, error) {
	obj := map[string]json.RawMessage{}
	if fields != nil {
		raw, err := json.Marshal(fields)
		if err != nil {
			return nil, err
		}
		if !bytes.Equal(raw, []byte("null")) {
			if err := json.Unmarshal(raw, &obj); err != nil {
				return nil, fmt.Errorf("agenthost: %s fields are not a JSON object", typ)
			}
		}
	}
	if raw, ok := obj["account"]; ok {
		var other string
		if json.Unmarshal(raw, &other) != nil || other != account {
			return nil, fmt.Errorf("agenthost: %s names another account", typ)
		}
	}
	for key, value := range map[string]string{"type": typ, "id": id, "account": account} {
		if value == "" {
			delete(obj, key)
			continue
		}
		raw, _ := json.Marshal(value)
		obj[key] = raw
	}
	line, err := json.Marshal(obj)
	if err != nil {
		return nil, err
	}
	return append(line, '\n'), nil
}

// runField reads the "run" string from outgoing fields, for live-run
// tracking.
func runField(fields any) string {
	raw, err := json.Marshal(fields)
	if err != nil {
		return ""
	}
	var probe struct {
		Run string `json:"run"`
	}
	_ = json.Unmarshal(raw, &probe)
	return probe.Run
}

// readLine returns the next line without its terminator, refusing lines over
// max bytes.
func readLine(r *bufio.Reader, max int) ([]byte, error) {
	var buf []byte
	for {
		chunk, err := r.ReadSlice('\n')
		if len(buf)+len(chunk) > max {
			return nil, errLineTooLong
		}
		buf = append(buf, chunk...)
		if err == bufio.ErrBufferFull {
			continue
		}
		if err != nil {
			if len(buf) > 0 && errors.Is(err, io.EOF) {
				// A last line without a newline is still a line.
				return bytes.TrimRight(buf, "\r"), nil
			}
			return nil, err
		}
		return bytes.TrimRight(buf[:len(buf)-1], "\r"), nil
	}
}

// trimForLog keeps a log line readable.
func trimForLog(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}
