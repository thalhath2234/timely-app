package chat

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// What a live agent run looks like to the apps (plan 3.4 step 6, 5.4): the
// activity lines and the reply streamed so far, built from the worker's
// events. This part is pure, so the recorded worker fixtures can be replayed
// through it without a database (engine_live_test.go); the follower in
// engine_agent.go owns one per run and decides when to checkpoint it.

// maxActivityLines is how many activity lines a run keeps (the newest).
const maxActivityLines = 40

// workerEvent is an "event" line's body (PROTOCOL.md section 5).
type workerEvent struct {
	Kind    string `json:"kind"`
	Payload struct {
		Text       string          `json:"text"`
		ToolCallID string          `json:"tool_call_id"`
		Tool       string          `json:"tool"`
		Result     json.RawMessage `json:"result"`
		Kind       string          `json:"kind"`
		Message    string          `json:"message"`
		// tool.output_risk: Hermes' advisory threat scan of an untrusted
		// result (PROTOCOL.md section 5).
		Risk     string   `json:"risk"`
		Findings []string `json:"findings"`
		// clarify.request and clarify.closed (phase 4, PROTOCOL.md 11.2).
		RequestID string           `json:"request_id"`
		Questions []workerQuestion `json:"questions"`
		TimeoutS  int              `json:"timeout_s"`
		Outcome   string           `json:"outcome"`
		// subagent (phase 4, PROTOCOL.md 11.3): a sub-task starts or stops.
		Phase          string `json:"phase"`
		SubagentID     string `json:"subagent_id"`
		ChildSessionID string `json:"child_session_id"`
		Goal           string `json:"goal"`
		Status         string `json:"status"`
	} `json:"payload"`
}

// workerQuestion is one question of a clarify.request.
type workerQuestion struct {
	QID         string   `json:"qid"`
	Question    string   `json:"question"`
	Choices     []string `json:"choices"`
	Recommended *int     `json:"recommended"`
	MultiSelect bool     `json:"multi_select"`
}

// outputRisk is the log line for a tool.output_risk event: Hermes' advisory
// scan found prompt injection or the like in a web page, a search, or a
// Timely result that quotes outside text. The model already reads that
// result as untrusted data; the scan never blocks, so Go only records it.
func outputRisk(run string, ev workerEvent) (string, bool) {
	if ev.Kind != "tool.output_risk" || ev.Payload.Risk == "" || ev.Payload.Risk == "low" {
		return "", false
	}
	findings := strings.Join(ev.Payload.Findings, ", ")
	if findings == "" {
		findings = "none named"
	}
	return fmt.Sprintf("agent run %s: Hermes flagged the %s result %s as %s risk (%s)", run, clip(ev.Payload.Tool, 80), clip(ev.Payload.ToolCallID, 80), clip(ev.Payload.Risk, 20), clip(findings, 300)), true
}

// liveDelta is one streamed chunk as /chats/watch sends it (Shared
// contracts 4): offset is the draft's length in characters (Unicode code
// points, as the apps' applyDelta counts) before text.
type liveDelta struct {
	Run    string `json:"run"`
	Offset int    `json:"offset"`
	Text   string `json:"text"`
}

// liveRun is a run's activity and draft.
type liveRun struct {
	run   string
	lines []ActivityLine
	draft strings.Builder
	runes int
	// statuses numbers status lines; thinking is the index of the open
	// "Thinking" line, or -1.
	statuses int
	thinking int
}

func newLiveRun(run string) *liveRun { return &liveRun{run: run, thinking: -1} }

// event applies one worker event. changed says the activity changed (a
// checkpoint is due at the throttle); delta is the chunk to publish now.
func (l *liveRun) event(ev workerEvent, at time.Time) (changed bool, delta *liveDelta) {
	switch ev.Kind {
	case "delta":
		if ev.Payload.Text == "" {
			return false, nil
		}
		l.closeThinking()
		delta = &liveDelta{Run: l.run, Offset: l.runes, Text: ev.Payload.Text}
		l.draft.WriteString(ev.Payload.Text)
		l.runes += utf8.RuneCountInString(ev.Payload.Text)
		return true, delta
	case "reasoning":
		// The model's reasoning stays out of the row (it can be long and is
		// not the reply); the apps see that it is thinking.
		if l.thinking >= 0 {
			return false, nil
		}
		l.thinking = len(l.lines)
		l.add(ActivityLine{ID: "thinking-" + fmt.Sprint(len(l.lines)), Kind: "status", Label: "Thinking", State: "running", At: at})
		return true, nil
	case "tool.started":
		l.closeThinking()
		id := ev.Payload.ToolCallID
		if id == "" {
			id = fmt.Sprintf("tool-%d", len(l.lines))
		}
		for i := range l.lines {
			if l.lines[i].ID == id {
				return false, nil
			}
		}
		l.add(ActivityLine{ID: id, Kind: "tool", Label: toolLabel(ev.Payload.Tool), State: "running", At: at})
		return true, nil
	case "tool.completed":
		state := "done"
		if toolFailed(ev.Payload.Result) {
			state = "failed"
		}
		for i := len(l.lines) - 1; i >= 0; i-- {
			if l.lines[i].Kind == "tool" && l.lines[i].ID == ev.Payload.ToolCallID {
				l.lines[i].State = state
				return true, nil
			}
		}
		// A completion without its start (cut by the line cap) still shows.
		l.add(ActivityLine{ID: ev.Payload.ToolCallID, Kind: "tool", Label: toolLabel(ev.Payload.Tool), State: state, At: at})
		return true, nil
	case "status":
		text := strings.TrimSpace(ev.Payload.Message)
		if text == "" {
			text = strings.TrimSpace(ev.Payload.Kind)
		}
		if text == "" {
			return false, nil
		}
		l.statuses++
		l.add(ActivityLine{ID: fmt.Sprintf("status-%d", l.statuses), Kind: "status", Label: clip(text, 200), State: "done", At: at})
		return true, nil
	case "subagent":
		return l.subagent(ev, at), nil
	}
	// approval.request and learning events belong to later phases (the
	// question card of clarify.request is the follower's, ask).
	return false, nil
}

// subagent is a sub-task's activity line (phase 4): "Sub-task: <goal>",
// running from its start event until its stop event.
func (l *liveRun) subagent(ev workerEvent, at time.Time) bool {
	p := ev.Payload
	key := p.SubagentID
	if key == "" {
		key = p.ChildSessionID
	}
	if key == "" {
		return false
	}
	id := "subagent-" + clip(key, 80)
	state := "running"
	if p.Phase == "stop" {
		state = "done"
		switch p.Status {
		case "failed", "error", "interrupted", "timeout":
			state = "failed"
		}
	}
	for i := len(l.lines) - 1; i >= 0; i-- {
		if l.lines[i].ID == id {
			if l.lines[i].State == state {
				return false
			}
			l.lines[i].State = state
			return true
		}
	}
	goal := strings.TrimSpace(strings.Join(strings.Fields(dropNUL(p.Goal)), " "))
	label := "Sub-task"
	if goal != "" {
		label = "Sub-task: " + clip(goal, 200)
	}
	l.add(ActivityLine{ID: id, Kind: "subagent", Label: label, State: state, At: at})
	return true
}

// closeThinking marks the open "Thinking" line done.
func (l *liveRun) closeThinking() {
	if l.thinking >= 0 && l.thinking < len(l.lines) {
		l.lines[l.thinking].State = "done"
	}
	l.thinking = -1
}

func (l *liveRun) add(line ActivityLine) {
	l.lines = append(l.lines, line)
	if over := len(l.lines) - maxActivityLines; over > 0 {
		l.lines = append([]ActivityLine(nil), l.lines[over:]...)
		if l.thinking >= 0 {
			l.thinking -= over
		}
	}
}

// activity is the row's activity column for this run.
func (l *liveRun) activity() ChatActivity {
	lines := append([]ActivityLine(nil), l.lines...)
	return ChatActivity{Run: l.run, Lines: lines, Draft: l.draft.String()}
}

// endLines marks every line still running as failed or done when the run
// ends without a reply (stopped, failed): nothing is left spinning.
func (l *liveRun) endLines() {
	for i := range l.lines {
		if l.lines[i].State == "running" {
			l.lines[i].State = "failed"
		}
	}
}

// toolLabel is how an activity line names a tool: "get_task" reads "Get
// task". The apps may word it their own way from the label.
func toolLabel(tool string) string {
	switch tool {
	case "propose_changes":
		return "Preparing changes"
	case targetTool:
		return "Finding the item"
	case "":
		return "Tool"
	}
	words := strings.ReplaceAll(tool, "_", " ")
	return strings.ToUpper(words[:1]) + words[1:]
}

// toolFailed reports whether a tool.completed result is an error: Timely's
// {"error": ...} answers, which reach the worker as JSON text.
func toolFailed(result json.RawMessage) bool {
	var text string
	if json.Unmarshal(result, &text) == nil {
		result = json.RawMessage(text)
	}
	var head struct {
		Error *json.RawMessage `json:"error"`
	}
	return json.Unmarshal(result, &head) == nil && head.Error != nil
}
