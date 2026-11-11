package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Result is what one scenario did on one engine.
type Result struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Message  string `json:"message"`
	Engine   string `json:"engine"`
	ChatID   string `json:"chatId,omitempty"`
	// TurnEngine ran the message's turn; RunEngine ran the last run (an
	// approved apply always runs classic).
	TurnEngine string   `json:"turnEngine,omitempty"`
	RunEngine  string   `json:"runEngine,omitempty"`
	Status     string   `json:"status"`
	Error      string   `json:"error,omitempty"`
	Action     string   `json:"errorAction,omitempty"`
	Replies    []string `json:"replies,omitempty"`
	Notices    []string `json:"notices,omitempty"`
	// Proposal is the turn's first proposal (before Approve).
	Proposal *Proposal `json:"proposal,omitempty"`
	// Plan is the stored plan at the end (after Approve when pressed).
	Plan     []PlanStep `json:"plan,omitempty"`
	Approved bool       `json:"approved"`
	// AfterApprove: "applied", "replanned", "failed" or "" (not approved).
	AfterApprove string `json:"afterApprove,omitempty"`
	// Trace is the tool calls seen while the run was live: the agent
	// engine's activity lines, and with -dsn classic's transcript.
	Trace   []string `json:"trace,omitempty"`
	Seconds float64  `json:"seconds"`
	Pass    bool     `json:"pass"`
	Why     []string `json:"why,omitempty"`
	// HarnessError is a failure of the harness or the setup, not the run.
	HarnessError string `json:"harnessError,omitempty"`
}

// Proposal is a recorded proposal.
type Proposal struct {
	Summary     string     `json:"summary"`
	AutoApplied bool       `json:"autoApplied"`
	Held        bool       `json:"held"`
	Steps       []PlanStep `json:"steps"`
}

// PlanStep is one step of a plan.
type PlanStep struct {
	Tool    string `json:"tool"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

// Score fills Pass and Why from the scenario's expectations.
func Score(s Scenario, r *Result) {
	r.Pass, r.Why = true, nil
	fail := func(format string, args ...any) {
		r.Pass = false
		r.Why = append(r.Why, fmt.Sprintf(format, args...))
	}
	if r.HarnessError != "" {
		fail("harness: %s", r.HarnessError)
		return
	}
	if r.Status == "failed" {
		fail("run failed: %s", r.Error)
	}
	switch s.Expect.Outcome {
	case "proposal":
		if r.Proposal == nil {
			fail("expected a proposal, got none")
		}
	case "reply":
		if r.Proposal != nil {
			fail("expected a reply without changes, got a proposal (%s)", strings.Join(proposalTools(r.Proposal), ", "))
		}
		if len(r.Replies) == 0 {
			fail("expected a reply, got none")
		}
	}
	if r.Proposal != nil {
		tools := proposalTools(r.Proposal)
		for _, want := range s.Expect.Tools {
			if !slices.Contains(tools, want) {
				fail("proposal lacks %s (has %s)", want, strings.Join(tools, ", "))
			}
		}
	}
	if len(s.Expect.ReplyAny) > 0 {
		all := strings.ToLower(strings.Join(r.Replies, "\n"))
		hit := false
		for _, w := range s.Expect.ReplyAny {
			hit = hit || strings.Contains(all, strings.ToLower(w))
		}
		if !hit {
			fail("reply mentions none of %q", s.Expect.ReplyAny)
		}
	}
	if s.Expect.AfterApprove != "" && r.Proposal != nil {
		if !r.Approved {
			fail("expected Approve (%s), the proposal was not approved", s.Expect.AfterApprove)
		} else if r.AfterApprove != s.Expect.AfterApprove {
			fail("after Approve: expected %s, got %s", s.Expect.AfterApprove, orNone(r.AfterApprove))
		}
	}
}

func proposalTools(p *Proposal) []string {
	var out []string
	for _, s := range p.Steps {
		out = append(out, s.Tool)
	}
	return out
}

func orNone(s string) string {
	if s == "" {
		return "nothing"
	}
	return s
}

// EngineRun is one engine's results, written as <engine>.json.
type EngineRun struct {
	Engine     string    `json:"engine"`
	API        string    `json:"api"`
	Provider   string    `json:"provider"`
	Model      string    `json:"model"`
	Permission string    `json:"permission"`
	Stub       bool      `json:"stub"`
	Account    string    `json:"account"`
	Started    time.Time `json:"started"`
	Seconds    float64   `json:"seconds"`
	// Unavailable is why the engine could not run (Settings' engineReason).
	Unavailable string   `json:"unavailable,omitempty"`
	Results     []Result `json:"results"`
}

// Passed counts passing results.
func (e EngineRun) Passed() int {
	n := 0
	for _, r := range e.Results {
		if r.Pass {
			n++
		}
	}
	return n
}

// WriteJSON writes one engine's results.
func WriteJSON(dir string, run EngineRun) (string, error) {
	path := filepath.Join(dir, run.Engine+".json")
	raw, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, append(raw, '\n'), 0o644)
}

// Markdown is the side-by-side report of one or two engine runs.
func Markdown(runs []EngineRun, scenarios []Scenario) string {
	var b strings.Builder
	b.WriteString("# Agent parity report\n\n")
	if len(runs) == 0 {
		b.WriteString("No engine ran.\n")
		return b.String()
	}
	first := runs[0]
	fmt.Fprintf(&b, "API `%s`, provider `%s`, model `%s`, permission `%s`%s, %s.\n\n",
		first.API, first.Provider, first.Model, first.Permission, map[bool]string{true: ", stub directives", false: ""}[first.Stub],
		first.Started.UTC().Format("2006-01-02 15:04 UTC"))
	b.WriteString("| Engine | Passed | Scenarios | Seconds | Note |\n|---|---|---|---|---|\n")
	for _, r := range runs {
		fmt.Fprintf(&b, "| %s | %d | %d | %.0f | %s |\n", r.Engine, r.Passed(), len(r.Results), r.Seconds, cell(r.Unavailable))
	}
	byEngine := map[string]map[string]Result{}
	for _, r := range runs {
		m := map[string]Result{}
		for _, res := range r.Results {
			m[res.ID] = res
		}
		byEngine[r.Engine] = m
	}
	b.WriteString("\n## By category\n\n| Category |")
	for _, r := range runs {
		fmt.Fprintf(&b, " %s |", r.Engine)
	}
	b.WriteString("\n|---|")
	for range runs {
		b.WriteString("---|")
	}
	b.WriteString("\n")
	for _, cat := range Categories {
		total := 0
		for _, s := range scenarios {
			if s.Category == cat {
				total++
			}
		}
		if total == 0 {
			continue
		}
		fmt.Fprintf(&b, "| %s |", cat)
		for _, r := range runs {
			pass := 0
			for _, s := range scenarios {
				if res, ok := byEngine[r.Engine][s.ID]; ok && s.Category == cat && res.Pass {
					pass++
				}
			}
			fmt.Fprintf(&b, " %d/%d |", pass, total)
		}
		b.WriteString("\n")
	}
	b.WriteString("\n## Scenarios\n\n| Scenario |")
	for _, r := range runs {
		fmt.Fprintf(&b, " %s |", r.Engine)
	}
	if len(runs) == 2 {
		b.WriteString(" Same outcome |")
	}
	b.WriteString("\n|---|")
	for range runs {
		b.WriteString("---|")
	}
	if len(runs) == 2 {
		b.WriteString("---|")
	}
	b.WriteString("\n")
	diverged := 0
	for _, s := range scenarios {
		fmt.Fprintf(&b, "| `%s` %s |", s.ID, cell(s.Message))
		var outcomes []string
		for _, r := range runs {
			res, ok := byEngine[r.Engine][s.ID]
			if !ok {
				b.WriteString(" not run |")
				outcomes = append(outcomes, "not run")
				continue
			}
			outcomes = append(outcomes, outcome(res))
			mark := "PASS"
			if !res.Pass {
				mark = "FAIL"
			}
			text := mark + " " + outcome(res)
			if !res.Pass {
				text += ": " + strings.Join(res.Why, "; ")
			}
			fmt.Fprintf(&b, " %s |", cell(text))
		}
		if len(runs) == 2 {
			same := outcomes[0] == outcomes[1]
			if !same {
				diverged++
			}
			fmt.Fprintf(&b, " %s |", map[bool]string{true: "yes", false: "**no**"}[same])
		}
		b.WriteString("\n")
	}
	if len(runs) == 2 {
		fmt.Fprintf(&b, "\n%d of %d scenarios ended differently on the two engines.\n", diverged, len(scenarios))
	}
	return b.String()
}

// outcome is a short description of what a run ended with.
func outcome(r Result) string {
	switch {
	case r.HarnessError != "":
		return "harness error"
	case r.Status == "failed":
		return "failed"
	case r.Proposal != nil:
		s := "proposal " + strings.Join(proposalTools(r.Proposal), "+")
		if r.Proposal.AutoApplied {
			s += " (applied)"
		}
		if r.AfterApprove != "" {
			s += ", " + r.AfterApprove
		}
		return s
	case len(r.Replies) > 0:
		return "reply"
	}
	return r.Status
}

func cell(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), "\n", " ")
	s = strings.ReplaceAll(s, "|", "\\|")
	if r := []rune(s); len(r) > 160 {
		s = string(r[:157]) + "..."
	}
	return s
}
