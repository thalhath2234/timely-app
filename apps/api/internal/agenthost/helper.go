package agenthost

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// The two steps Go runs with the agent runtime before it spawns workers
// (apps/agent/PROTOCOL.md "Before spawning"). Each reads an optional JSON
// object on stdin and prints one JSON object on stdout: the result with
// "ok": true (exit 0), or {"ok": false, "error": ...} (exit 1).
//
//	prepare --agent-dir <root>                      once: managed config, seed tree, Timely skills
//	render-account --agent-dir <root> --account ID  before each spawn: config.yaml, SOUL.md;
//	                                                answers config_sha256 for hello.settings_hash

const (
	prepareTimeout = 3 * time.Minute
	renderTimeout  = time.Minute
	maxHelperOut   = 4 << 20
)

// ErrHelperFailed is a failed prepare or render-account step.
var ErrHelperFailed = errors.New("agent runtime step failed")

// PrepareResult is what prepare reports that the supervisor uses. The
// supervisor keeps it in memory: the managed file must still hash to
// ManagedSHA256 before each spawn, and hello (and render-account's
// --prepared) carry the rest, so neither the worker's canary nor the account
// render ever takes its values from the agent folder (runtime/prepared.json
// is writable by anything running as the same OS user). SkillsDefaultOff is
// policy: the reviewed bundled skills each account keeps in skills.disabled
// unless the person turned them on.
type PrepareResult struct {
	SeedSkillsDir     string   `json:"seed_skills_dir"`
	TimelySkillsDir   string   `json:"timely_skills_dir"`
	BrowserExecutable string   `json:"browser_executable"`
	ManagedSHA256     string   `json:"managed_sha256"`
	SkillsDefaultOff  []string `json:"skills_default_off"`
}

// renderInput is prepare's answer as render-account's --prepared takes it.
func (r PrepareResult) renderInput() (string, error) {
	b, err := json.Marshal(map[string]any{
		"timely_skills_dir":  r.TimelySkillsDir,
		"seed_skills_dir":    r.SeedSkillsDir,
		"browser_executable": r.BrowserExecutable,
		"skills_default_off": r.defaultOff(),
	})
	return string(b), err
}

// defaultOff is never nil, so it encodes as a list (the worker refuses null).
func (r PrepareResult) defaultOff() []string {
	if r.SkillsDefaultOff == nil {
		return []string{}
	}
	return r.SkillsDefaultOff
}

type helperAnswer struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// runHelper runs one runtime step with env and input on stdin, and decodes
// its JSON answer into out.
func (s *Supervisor) runHelper(ctx context.Context, timeout time.Duration, env []string, input any, out any, sub ...string) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	stdin, err := json.Marshal(input)
	if err != nil {
		return err
	}
	if bytes.Equal(stdin, []byte("null")) { // a nil map or no input at all
		stdin = []byte("{}")
	}
	args := s.cfg.Runtime.command(sub...)
	cmd := exec.CommandContext(ctx, s.cfg.Runtime.Program, args...)
	cmd.Env = env
	cmd.Dir = s.layout.Runtime()
	cmd.Stdin = bytes.NewReader(stdin)
	var stdout bytes.Buffer
	cmd.Stdout = &limitedBuffer{buf: &stdout, max: maxHelperOut}
	tail := &logTail{logf: func(format string, args ...any) {
		s.logf("agent %s stderr: "+format, append([]any{sub[0]}, args...)...)
	}}
	cmd.Stderr = tail
	cmd.WaitDelay = 2 * time.Second
	configureCmd(cmd)
	runErr := cmd.Run()

	var answer helperAnswer
	line := bytes.TrimSpace(lastLine(stdout.Bytes()))
	decodeErr := json.Unmarshal(line, &answer)
	switch {
	case decodeErr == nil && answer.OK && runErr == nil:
		if out != nil {
			return json.Unmarshal(line, out)
		}
		return nil
	case decodeErr == nil && answer.Error != "":
		return fmt.Errorf("%w: %s: %s", ErrHelperFailed, sub[0], answer.Error)
	case runErr != nil:
		return fmt.Errorf("%w: %s: %v; %s", ErrHelperFailed, sub[0], runErr, strings.Join(tail.Tail(), " | "))
	default:
		return fmt.Errorf("%w: %s: unreadable answer %q", ErrHelperFailed, sub[0], trimForLog(string(line), 200))
	}
}

func lastLine(b []byte) []byte {
	b = bytes.TrimRight(b, "\r\n")
	if i := bytes.LastIndexByte(b, '\n'); i >= 0 {
		return b[i+1:]
	}
	return b
}

type limitedBuffer struct {
	buf *bytes.Buffer
	max int
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	if room := l.max - l.buf.Len(); room > 0 {
		if len(p) > room {
			l.buf.Write(p[:room])
		} else {
			l.buf.Write(p)
		}
	}
	return len(p), nil
}

// Prepare runs the host-wide prepare step (plan 6.3, 9.1): the managed
// config with its canary read-back, the seed tree and the read-only Timely
// skills copy. Ensure runs it once on its own when Config.RenderAccount is
// set; calling it at API start (with options such as browser_executable)
// moves that cost out of the first chat. Its seed folder becomes the
// workers' HERMES_BUNDLED_SKILLS unless Config.Env.BundledSkills is set.
func (s *Supervisor) Prepare(ctx context.Context, opts map[string]any) (PrepareResult, error) {
	s.prepMu.Lock()
	defer s.prepMu.Unlock()
	return s.prepareLocked(ctx, opts)
}

func (s *Supervisor) prepareLocked(ctx context.Context, opts map[string]any) (PrepareResult, error) {
	if s.cfg.Runtime.Program == "" {
		return PrepareResult{}, &StartError{Err: ErrNoRuntime, Detail: errDetail(s.cfg.RuntimeErr)}
	}
	if err := s.layout.prepare(""); err != nil {
		return PrepareResult{}, err
	}
	env, err := envList(hostEnv(s.layout, s.cfg.Env))
	if err != nil {
		return PrepareResult{}, err
	}
	var res PrepareResult
	if err := s.runHelper(ctx, prepareTimeout, env, opts, &res, "prepare", "--agent-dir", s.layout.Root); err != nil {
		return PrepareResult{}, err
	}
	if res.SeedSkillsDir != "" && !within(s.layout.Root, res.SeedSkillsDir) {
		return PrepareResult{}, fmt.Errorf("%w: prepare put the seed tree outside %s", ErrHelperFailed, s.layout.Root)
	}
	if res.TimelySkillsDir != "" && !within(s.layout.Root, res.TimelySkillsDir) {
		return PrepareResult{}, fmt.Errorf("%w: prepare put the Timely skills outside %s", ErrHelperFailed, s.layout.Root)
	}
	s.prepared = true
	s.prep = res
	return res, nil
}

// ErrManagedChanged means managed/config.yaml no longer hashes to what
// prepare wrote. The managed overlay wins over every account's config, so a
// worker is never started on an edited one; restarting the API re-prepares.
var ErrManagedChanged = errors.New("the agent's managed config changed since the API started")

// preparedFor is prepare's answer for the next spawn, after checking the
// managed file still hashes to it. Zero when prepare has not run (no
// Config.RenderAccount): nothing to check and nothing to send.
func (s *Supervisor) preparedFor() (PrepareResult, error) {
	s.prepMu.Lock()
	res, ok := s.prep, s.prepared
	s.prepMu.Unlock()
	if !ok || res.ManagedSHA256 == "" {
		return res, nil
	}
	data, err := os.ReadFile(filepath.Join(s.layout.Managed(), "config.yaml"))
	if err != nil {
		return res, fmt.Errorf("%w: %v", ErrManagedChanged, err)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != res.ManagedSHA256 {
		return res, fmt.Errorf("%w: managed/config.yaml hashes to %s, prepare wrote %s", ErrManagedChanged, got[:12], trimForLog(res.ManagedSHA256, 12))
	}
	return res, nil
}

// ensurePrepared runs prepare once before the first render-account.
func (s *Supervisor) ensurePrepared(ctx context.Context) error {
	s.prepMu.Lock()
	defer s.prepMu.Unlock()
	if s.prepared {
		return nil
	}
	_, err := s.prepareLocked(ctx, nil)
	return err
}

// hostConfig is the EnvConfig workers get: Config.Env plus the seed folder
// prepare reported.
func (s *Supervisor) hostConfig() EnvConfig {
	env := s.cfg.Env
	s.prepMu.Lock()
	if env.BundledSkills == "" {
		env.BundledSkills = s.prep.SeedSkillsDir
	}
	s.prepMu.Unlock()
	return env
}

// renderAccount writes the account's config.yaml and SOUL.md from its
// settings and returns config.yaml's sha256 for hello.settings_hash.
func (s *Supervisor) renderAccount(ctx context.Context, account string, settings json.RawMessage) (string, error) {
	if err := s.ensurePrepared(ctx); err != nil {
		return "", err
	}
	env, err := BuildEnv(s.layout, account, s.hostConfig(), nil)
	if err != nil {
		return "", err
	}
	var input any = map[string]any{}
	if len(bytes.TrimSpace(settings)) > 0 {
		input = settings
	}
	s.prepMu.Lock()
	prep := s.prep
	s.prepMu.Unlock()
	prepared, err := prep.renderInput()
	if err != nil {
		return "", err
	}
	var out struct {
		ConfigSHA256 string `json:"config_sha256"`
	}
	if err := s.runHelper(ctx, renderTimeout, env, input, &out, "render-account", "--agent-dir", s.layout.Root, "--account", account, "--prepared", prepared); err != nil {
		return "", err
	}
	if out.ConfigSHA256 == "" {
		return "", fmt.Errorf("%w: render-account gave no config_sha256", ErrHelperFailed)
	}
	return out.ConfigSHA256, nil
}

func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func errDetail(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
