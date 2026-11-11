package chat

import (
	"context"

	"timely-api/internal/agenthost"
)

// Phase 3 on the agent engine (PROTOCOL.md section 10.1, plan 9b.2): which
// learning, past-chat search and web a run gets, and Go's gate verdicts.

// runSetup is what run.start says about learning, past-chat search and the
// web for one run.
type runSetup struct {
	learningWrites, searchHistory bool
	toolsets                      []string
	// taintedConversations are the account's chats with outside text (a
	// past-chat search hit from one taints the run), searchExclude its
	// "Don't learn from this chat" chats (never search hits), personHosts
	// the sites the person typed here or their bots read (the
	// exfiltration rule allows them after taint).
	taintedConversations, searchExclude, personHosts []string
}

// runSetup decides a run's flags from the account's learning switches and
// the chat's own rows, and sets the run's web state on tools.
//
//   - learning_writes: learning on, not Sensitive, not "Don't learn from this
//     chat", not an answer-only turn;
//   - search_history: "Search my past chats" and learning_writes;
//   - web: the chat's web toggle, not Sensitive, not answer-only.
//
// A switch that cannot be read leaves learning off, and a list of tainted
// chats that cannot be read turns past-chat search off: a hit from a chat
// with outside text must taint the run.
func (e *WorkerEngine) runSetup(ctx context.Context, c *Conversation, tools *toolRun) runSetup {
	var prefs LearningPrefs
	if e.opts.Learning != nil {
		var err error
		if prefs, err = e.opts.Learning(ctx, c.UserID); err != nil {
			e.opts.Logf("agent engine: learning settings: %v", err)
			prefs = LearningPrefs{}
		}
	}
	out := runSetup{taintedConversations: []string{}, searchExclude: []string{}}
	out.learningWrites = prefs.Learning && !c.Sensitive && !c.NoLearning && !tools.answerOnly
	out.searchHistory = prefs.SearchHistory && out.learningWrites
	tools.web.on = c.WebSearch && !c.Sensitive && !tools.answerOnly
	tools.web.fetch = e.opts.Fetch
	tools.taintSeen = len(c.TaintedSources) > 0

	if err := e.s.db.WithContext(ctx).Model(&Conversation{}).Where("user_id = ? AND no_learning", c.UserID).
		Order("updated_at DESC").Limit(5000).Pluck("id", &out.searchExclude).Error; err != nil {
		e.opts.Logf("agent engine: chats not to learn from: %v", err)
		out.searchHistory = false
	}
	if err := e.s.db.WithContext(ctx).Model(&Conversation{}).
		Where("user_id = ? AND jsonb_typeof(tainted_sources) = 'array' AND tainted_sources <> '[]'::jsonb", c.UserID).
		Order("updated_at DESC").Limit(5000).Pluck("id", &out.taintedConversations).Error; err != nil {
		e.opts.Logf("agent engine: chats with outside text: %v", err)
		out.searchHistory = false
	}
	if out.searchExclude == nil {
		out.searchExclude = []string{}
	}
	if out.taintedConversations == nil {
		out.taintedConversations = []string{}
	}
	out.personHosts = e.s.fetchGuard(ctx, c).hosts()
	out.toolsets = runToolsets(out.learningWrites, out.searchHistory, tools.web.on)
	return out
}

// runToolsets are a chat run's Hermes toolsets: phase 2's, plus memory,
// past-chat search and the web when the run has them.
func runToolsets(learningWrites, searchHistory, web bool) []string {
	out := append([]string{}, chatToolsets...)
	if learningWrites {
		out = append(out, "memory")
	}
	if searchHistory {
		out = append(out, "session_search")
	}
	if web {
		out = append(out, "web")
	}
	return out
}

// withRunCompleter attaches the client of the provider and model the run
// fixed at claim, so the timely backend's web_search uses the chat's own
// provider. A provider that cannot be set up answers every search with its
// reason; nothing switches to another provider.
func (s *Service) withRunCompleter(ctx context.Context, c *Conversation) context.Context {
	if s.completers == nil {
		return ctx
	}
	completer, err := s.completers.Completer(ctx, c.UserID, c.Provider, c.Model)
	if err != nil {
		return WithCompleter(ctx, unusable{err})
	}
	return WithCompleter(ctx, completer)
}

// gate answers a gate.ask: web_search and web_extract run when the run has
// the web (flags.web); every other tool keeps phase 2's block.
func (e *WorkerEngine) gate(r *agentRun, m agenthost.Message) {
	var ask struct {
		Tool    string        `json:"tool"`
		Tainted []TaintSource `json:"tainted_sources"`
	}
	_ = m.Decode(&ask)
	r.noteTaint(ask.Tainted)
	verdict, message := gateVerdict(r.tools, ask.Tool)
	_ = r.worker.Reply(m, agenthost.TypeGateVerdict, map[string]any{"verdict": verdict, "message": message})
}

// gateVerdict is Go's answer for one tool the worker asks about.
func gateVerdict(run *toolRun, tool string) (verdict, message string) {
	if webTools[tool] {
		if run.web.on {
			return "allow", ""
		}
		return "block", webOff
	}
	return "block", gateBlocked
}

// noteTaint keeps outside sources the run reported for the chat's
// tainted_sources, and marks the run tainted.
func (r *agentRun) noteTaint(sources []TaintSource) {
	if len(sources) == 0 {
		return
	}
	r.taint = append(r.taint, sources...)
	r.dirty = true
	r.tools.taintSeen = true
}
