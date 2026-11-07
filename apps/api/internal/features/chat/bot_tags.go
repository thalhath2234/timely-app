package chat

import (
	"context"
	"encoding/json"
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// A person tags a Bot in a message ("@Go news feed, anything new?", or the
// apps' picker) to ask it what it knows. The run for that message only
// answers: it may read the tagged Bots and nothing else, and it can change
// nothing, whatever the model calls or a page it read says. Tags belong to
// the one message; the next message without one is a normal turn.

// BotName is one of the person's Bots, as tags find them.
type BotName struct {
	ID   string
	Name string
}

// maxBotTags is how many Bots one message may tag.
const maxBotTags = 3

// maxAsks is how many times one run may call ask_bot, in every mode: each
// may start a check of a page.
const maxAsks = 3

// answerTools are the only tools a run for a tagged message is offered or
// may call.
var answerTools = map[string]bool{"get_context": true, "list_bots": true, "get_bot": true, "list_bot_findings": true, "ask_bot": true}

// answerOnlyRefusal is the result of any other call in such a run.
const answerOnlyRefusal = "A tagged bot only answers. Nothing can be changed or looked up beyond the bot in this turn."

// outsideReads are the reads whose results carry text from third-party
// pages. A run that called one has its proposal reviewed, so text a page
// planted cannot steer a change that would otherwise apply directly.
var outsideReads = map[string]bool{"preview_bot": true, "ask_bot": true, "list_bot_findings": true, "list_bots": true}

// SetBotNames lets messages tag the person's Bots; without it no message
// is tagged.
func (s *Service) SetBotNames(fn func(ctx context.Context, userID string) ([]BotName, error)) {
	s.botNames = fn
}

// tagBots finds the Bots text tags: "@" at the start or after a space, then
// a Bot's name in any case (the longest name that fits wins), then the end,
// a space or one of ,.:;?! . At most maxBotTags, in order of appearance,
// each once.
func tagBots(text string, names []BotName) []BotName {
	sorted := make([]BotName, 0, len(names))
	for _, n := range names {
		if strings.TrimSpace(n.Name) != "" {
			sorted = append(sorted, n)
		}
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		return utf8.RuneCountInString(sorted[i].Name) > utf8.RuneCountInString(sorted[j].Name)
	})
	out := []BotName{}
	seen := map[string]bool{}
	prev := ' '
	for i := 0; i < len(text) && len(out) < maxBotTags; {
		r, size := utf8.DecodeRuneInString(text[i:])
		if r != '@' || !unicode.IsSpace(prev) {
			prev = r
			i += size
			continue
		}
		rest := text[i+size:]
		matched := 0
		for _, n := range sorted {
			if end, ok := nameAt(rest, n.Name); ok {
				if !seen[n.ID] {
					seen[n.ID] = true
					out = append(out, n)
				}
				matched = end
				break
			}
		}
		prev = r
		i += size + matched
		if matched > 0 {
			prev = 'x' // the name's last character, never a space
		}
	}
	return out
}

// nameAt reports whether text starts with name, in any case and followed by
// the end, a space or a closing mark, and how many bytes the name took.
func nameAt(text, name string) (int, bool) {
	i := 0
	for _, want := range name {
		if i >= len(text) {
			return 0, false
		}
		got, size := utf8.DecodeRuneInString(text[i:])
		if got != want && !strings.EqualFold(string(got), string(want)) {
			return 0, false
		}
		i += size
	}
	if i == len(text) {
		return i, true
	}
	next, _ := utf8.DecodeRuneInString(text[i:])
	return i, unicode.IsSpace(next) || strings.ContainsRune(",.:;?!", next)
}

// messageTags are the Bots a new message tags: those its text names, then
// those the apps' picker sent, each once, at most maxBotTags, and only the
// person's own.
func (s *Service) messageTags(ctx context.Context, userID string, in sendInput) ([]string, error) {
	if s.botNames == nil || (len(in.BotTags) == 0 && !strings.Contains(in.Content, "@")) {
		return nil, nil
	}
	names, err := s.botNames(ctx, userID)
	if err != nil {
		return nil, err
	}
	mine := map[string]bool{}
	for _, n := range names {
		mine[n.ID] = true
	}
	out := []string{}
	add := func(id string) {
		if mine[id] && !slices.Contains(out, id) && len(out) < maxBotTags {
			out = append(out, id)
		}
	}
	for _, n := range tagBots(in.Content, names) {
		add(n.ID)
	}
	for _, id := range in.BotTags {
		add(id)
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// latestTags are the Bots the person's latest message tags. Only that
// message decides whether a run only answers.
func latestTags(c *Conversation) []string {
	for i := len(c.Messages) - 1; i >= 0; i-- {
		if m := c.Messages[i]; m.Role == "user" && m.Kind == "" {
			return m.BotTags
		}
	}
	return nil
}

// tagNotice tells the model which Bots were tagged and that it only answers.
func (s *Service) tagNotice(ctx context.Context, userID string, tags []string) string {
	named := map[string]string{}
	if s.botNames != nil {
		if names, err := s.botNames(ctx, userID); err == nil {
			for _, n := range names {
				named[n.ID] = n.Name
			}
		}
	}
	listed := make([]string, len(tags))
	for i, id := range tags {
		if name := named[id]; name != "" {
			listed[i] = clip(name, 80) + " (" + id + ")"
		} else {
			listed[i] = id
		}
	}
	return "System notice (not written by the user): the person tagged these bots: " + strings.Join(listed, ", ") + ". Call ask_bot once for each tagged bot, then answer their question in two or three sentences from what it returns. A tagged bot only answers: nothing can be changed in this turn, so do not offer or propose changes; if they want a change, they can ask again without the tag."
}

// botAnswers keeps a run's ask_bot answers by Bot, the last one winning.
type botAnswers struct {
	order []string
	byID  map[string]json.RawMessage
}

// add keeps an ask_bot result, without the outside-data marker meant for
// the model. A result without a Bot id is skipped.
func (a *botAnswers) add(result []byte) {
	answer := withoutMarker(result)
	var head struct {
		Bot struct {
			ID string `json:"id"`
		} `json:"bot"`
	}
	if json.Unmarshal(answer, &head) != nil || head.Bot.ID == "" {
		return
	}
	if a.byID == nil {
		a.byID = map[string]json.RawMessage{}
	}
	if _, ok := a.byID[head.Bot.ID]; !ok {
		a.order = append(a.order, head.Bot.ID)
	}
	a.byID[head.Bot.ID] = answer
}

// list is the answers for a reply: the tagged Bots' first, in tag order,
// then the rest in the order they were first asked.
func (a *botAnswers) list(tags []string) []json.RawMessage {
	if len(a.byID) == 0 {
		return nil
	}
	out := []json.RawMessage{}
	for _, id := range tags {
		if v, ok := a.byID[id]; ok {
			out = append(out, v)
		}
	}
	for _, id := range a.order {
		if !slices.Contains(tags, id) {
			out = append(out, a.byID[id])
		}
	}
	return out
}

// withoutMarker drops the outsideData marker from a bot tool's result, for
// what is stored for the apps.
func withoutMarker(result []byte) json.RawMessage {
	var object map[string]json.RawMessage
	if json.Unmarshal(result, &object) != nil {
		return json.RawMessage(result)
	}
	delete(object, "outsideData")
	return raw(object)
}

// botRun is what a run did with the bot tools so far, read back from its
// transcript when an expired lease resumes it.
type botRun struct {
	asks    int  // ask_bot calls
	outside bool // a read of third-party text succeeded
	answers botAnswers
}

func replayBotRun(transcript []WireMessage) botRun {
	var run botRun
	called := map[string]string{}
	for _, m := range transcript {
		for _, tc := range m.ToolCalls {
			called[tc.ID] = tc.Function.Name
		}
		if m.Role != "tool" {
			continue
		}
		run.note(called[m.ToolCallID], []byte(m.Content))
	}
	return run
}

// note records one tool result as it reached the model.
func (r *botRun) note(name string, content []byte) {
	if name == "ask_bot" {
		r.asks++
	}
	var head struct {
		Error *string `json:"error"`
	}
	if json.Unmarshal(content, &head) != nil || head.Error != nil {
		return
	}
	if outsideReads[name] {
		r.outside = true
	}
	if name == "ask_bot" {
		r.answers.add(content)
	}
}
