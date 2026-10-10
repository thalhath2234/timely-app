package search

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/embed"
	"unicode"
)

// Smart search (ADR 0012, Phase 3): Jev reorders results, drops clear
// misses, guesses the kind of item wanted, spots "make a budget sheet" as a
// command, and checks which nearby items are really related. Without a key,
// or when Jev is unsure or slow, every answer is empty and screens show what
// they always did.

const (
	smartBudget   = 3 * time.Second
	relatedBudget = 4 * time.Second
	rerankTop     = 20 // results Jev checks: every result the search box shows
	relatedPool   = 8  // nearest items Jev checks for Related
	relatedShown  = 5
	pickBudget    = 8 * time.Second
	PickPool      = 40 // nearest tasks Jev checks for a bulk edit
)

// Decider asks Jev; *decide.Service implements it.
type Decider interface {
	Ask(ctx context.Context, userID string, req decide.Request) (decide.Answers, error)
}

type Smart struct {
	search    Service
	indexer   embed.Indexer
	decisions Decider
	views     ViewSource // nil until SetViews
}

func NewSmart(search Service, indexer embed.Indexer, decisions Decider) *Smart {
	return &Smart{search: search, indexer: indexer, decisions: decisions}
}

// Create is a "make a budget sheet" reading of the query.
type Create struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
}

// SmartResult is what the search screens apply on top of the plain results.
// Hits is nil when Jev did not answer: keep the plain order.
type SmartResult struct {
	Hits     []Hit     `json:"hits"`
	Hidden   []Hit     `json:"hidden,omitempty"`
	Category string    `json:"category,omitempty"`
	Create   *Create   `json:"create,omitempty"`
	View     *ViewPick `json:"view,omitempty"`
	LogID    string    `json:"logId,omitempty"`
}

var kindLabels = map[string]string{
	"task": "Work item", "project": "Project", "doc": "Doc", "sheet": "Sheet", "event": "Calendar event",
}

// Search runs the hybrid search and asks Jev about the top results, the kind
// wanted and whether the query is really a command.
func (s *Smart) Search(ctx context.Context, userID, query string, kinds []string) (SmartResult, error) {
	query = strings.TrimSpace(query)
	hits, err := s.search.SemanticSearch(ctx, userID, query, 20, kinds)
	if err != nil {
		return SmartResult{}, err
	}
	if s.decisions == nil || len([]rune(query)) < 2 {
		return SmartResult{}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, smartBudget)
	defer cancel()

	state, questions := rerankQuestions(query, hits)
	questions["intent"] = decide.Choice("Is the person looking for something they already have, or asking to create something new?",
		decide.Option{Name: "find", Description: "Find something that already exists"},
		decide.Option{Name: "doc", Description: "Create a new doc or note"},
		decide.Option{Name: "sheet", Description: "Create a new sheet or spreadsheet"},
		decide.Option{Name: "task", Description: "Create a new piece of work or to-do"},
		decide.Option{Name: "project", Description: "Create a new project"},
		decide.Option{Name: "event", Description: "Create a new calendar event"},
	).Twice()
	if len(allowedKinds(kinds)) == 0 {
		questions["category"] = decide.Choice("Which kind of item is the person most likely searching for?",
			decide.Option{Name: "doc", Description: "A doc, note or page of text"},
			decide.Option{Name: "sheet", Description: "A sheet or table of numbers"},
			decide.Option{Name: "task", Description: "A piece of work or to-do"},
			decide.Option{Name: "project", Description: "A project"},
			decide.Option{Name: "event", Description: "A calendar event or meeting"},
			decide.Option{Name: "any", Description: "Could be any kind; unclear"},
		).Twice()
	}
	var views []SavedView
	if s.views != nil && len(strings.Fields(query)) >= 2 {
		views = s.views(ctx, userID)
	}
	if len(views) > 0 {
		opts := []decide.Option{{Name: "none", Description: "None: the search looks for a particular item, or no saved view shows what it asks for"}}
		list := make([]map[string]string, 0, len(views))
		for i, v := range views {
			key := fmt.Sprintf("view%d", i+1)
			opts = append(opts, decide.Option{Name: key, Description: clip(v.Name, 80) + ": " + clip(v.Description, 200)})
			list = append(list, map[string]string{"view": key, "name": clip(v.Name, 80), "shows": clip(v.Description, 200)})
		}
		state["savedViews"] = list
		questions["view"] = decide.Choice("If the search asks to see a list of work (like \"what needs attention\" or \"my overdue tasks\") rather than one item, which of the person's saved views shows that list?", opts...).Twice()
	}
	answers, err := s.decisions.Ask(ctx, userID, decide.Request{Feature: "search", State: state, Questions: questions})
	if err != nil {
		return SmartResult{}, nil
	}

	out := SmartResult{LogID: answers.LogID}
	out.Hits, out.Hidden = applyRerank(hits, answers)
	if kind, ok := answers.Choice("category", decide.Prefill); ok && kind != "any" {
		out.Category = kind
	}
	if pick, ok := answers.Choice("view", decide.Route); ok && pick != "none" {
		var n int
		if _, err := fmt.Sscanf(pick, "view%d", &n); err == nil && n >= 1 && n <= len(views) {
			out.View = &ViewPick{ID: views[n-1].ID, Name: views[n-1].Name}
		}
	}
	if kind, ok := answers.Choice("intent", decide.Route); ok && kind != "find" {
		if title := createTitle(query, kind); title != "" {
			out.Create = &Create{Kind: kind, Title: title}
		}
	}
	return out, nil
}

// Rerank reorders an existing result list for the agent's semantic_search.
// ok is false when Jev did not answer; hidden are the clear misses.
func (s *Smart) Rerank(ctx context.Context, userID, query string, hits []Hit) (kept, hidden []Hit, ok bool) {
	if s == nil || s.decisions == nil || len(hits) == 0 || strings.TrimSpace(query) == "" {
		return hits, nil, false
	}
	ctx, cancel := context.WithTimeout(ctx, smartBudget)
	defer cancel()
	state, questions := rerankQuestions(query, hits)
	answers, err := s.decisions.Ask(ctx, userID, decide.Request{Feature: "search_rerank", State: state, Questions: questions})
	if err != nil {
		return hits, nil, false
	}
	kept, hidden = applyRerank(hits, answers)
	return kept, hidden, true
}

type stateHit struct {
	N     int    `json:"n"`
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Text  string `json:"text,omitempty"`
}

func rerankQuestions(query string, hits []Hit) (map[string]any, map[string]decide.Question) {
	top := hits
	if len(top) > rerankTop {
		top = top[:rerankTop]
	}
	results := make([]stateHit, len(top))
	questions := map[string]decide.Question{}
	for i, hit := range top {
		results[i] = stateHit{N: i + 1, Kind: kindLabels[hit.Kind], Title: titleOr(hit.Title), Text: clip(hit.Snippet, 200)}
		questions[fmt.Sprintf("match%d", i+1)] = decide.YesNo(
			fmt.Sprintf("Is result number %d something the person could be looking for with this search?", i+1),
			"Yes, it fits what they searched for", "No, it is unrelated to the search")
	}
	return map[string]any{"search": clip(query, 300), "results": results}, questions
}

// applyRerank sorts the checked results by how likely each is a match and
// moves clear misses to hidden. Unchecked results rank below every checked
// one, so they keep their order after them, or are hidden too once a checked
// result was a clear miss. A result Jev didn't answer about counts as an even
// chance.
func applyRerank(hits []Hit, answers decide.Answers) (kept, hidden []Hit) {
	type scored struct {
		hit Hit
		p   float64
	}
	n := min(len(hits), rerankTop)
	checked := make([]scored, 0, n)
	for i := range n {
		id := fmt.Sprintf("match%d", i+1)
		p := 0.5
		if a, ok := answers.Raw(id); ok {
			p = a.Yes
		}
		if yes, sure := answers.Yes(id, decide.Route); sure && !yes {
			hidden = append(hidden, hits[i])
			continue
		}
		checked = append(checked, scored{hits[i], p})
	}
	// Stable insertion sort: ties keep the search order.
	for i := 1; i < len(checked); i++ {
		for j := i; j > 0 && checked[j].p > checked[j-1].p; j-- {
			checked[j], checked[j-1] = checked[j-1], checked[j]
		}
	}
	kept = make([]Hit, 0, len(hits))
	for _, c := range checked {
		kept = append(kept, c.hit)
	}
	if len(hidden) > 0 {
		hidden = append(hidden, hits[n:]...)
	} else {
		kept = append(kept, hits[n:]...)
	}
	return kept, hidden
}

// Pick checks which of a shortlist of tasks fit a bulk edit's description
// ("everything about the website launch"), one yes/no per task. Matches are
// confident yeses, misses (a fairly sure no) are left out, and the rest come
// back as unsure. ok is false when Jev did not answer: the caller treats the
// shortlist as unchecked.
func (s *Smart) Pick(ctx context.Context, userID, description string, hits []Hit) (matches, unsure []Hit, left int, ok bool) {
	if s == nil || s.decisions == nil || len(hits) == 0 || strings.TrimSpace(description) == "" {
		return nil, hits, 0, false
	}
	if len(hits) > PickPool {
		hits = hits[:PickPool]
	}
	ctx, cancel := context.WithTimeout(ctx, pickBudget)
	defer cancel()
	tasks := make([]stateHit, len(hits))
	questions := map[string]decide.Question{}
	for i, hit := range hits {
		tasks[i] = stateHit{N: i + 1, Kind: kindLabels[hit.Kind], Title: titleOr(hit.Title), Text: clip(hit.Snippet, 160)}
		questions[fmt.Sprintf("pick%d", i+1)] = decide.YesNo(
			fmt.Sprintf("Does task number %d belong to the group the person described?", i+1),
			"Yes, it clearly belongs to that group", "No, it is about something else")
	}
	state := map[string]any{"group": clip(description, 300), "tasks": tasks}
	answers, err := s.decisions.Ask(ctx, userID, decide.Request{Feature: "bulk_pick", State: state, Questions: questions})
	if err != nil {
		return nil, hits, 0, false
	}
	// A match must be a confident yes; a fairly sure no is enough to leave a
	// task out, since the person only reviews what comes back.
	for i, hit := range hits {
		id := fmt.Sprintf("pick%d", i+1)
		if yes, sure := answers.Yes(id, decide.Route); sure && yes {
			matches = append(matches, hit)
		} else if yes, sure := answers.Yes(id, decide.Flag); sure && !yes {
			left++
		} else {
			unsure = append(unsure, hit)
		}
	}
	return matches, unsure, left, true
}

// RelatedItem is one entry in a Related list.
type RelatedItem struct {
	Kind    string `json:"kind"`
	ID      string `json:"id"`
	Title   string `json:"title"`
	Snippet string `json:"snippet,omitempty"`
}

// relatedKinds are the items that show a Related list and can appear in one.
var relatedKinds = map[string]bool{"task": true, "project": true, "doc": true, "sheet": true}

// Related lists items Jev confirms are about the same thing as the given one,
// from the nearest items by embedding. Empty when Jev or embeddings are off.
func (s *Smart) Related(ctx context.Context, userID, kind, id string) ([]RelatedItem, error) {
	if !relatedKinds[kind] || strings.TrimSpace(id) == "" {
		return nil, errors.New("kind must be task, project, doc or sheet, with an id")
	}
	out := []RelatedItem{}
	if s == nil || s.decisions == nil || s.indexer == nil || !s.indexer.EnabledFor(userID) {
		return out, nil
	}
	src, near, err := s.indexer.Related(ctx, userID, kind, id, relatedPool, []string{"task", "project", "doc", "sheet"})
	if err == nil && s.search != nil {
		near = s.search.Existing(userID, near)
	}
	if err != nil || len(near) == 0 {
		return out, nil
	}
	ctx, cancel := context.WithTimeout(ctx, relatedBudget)
	defer cancel()
	candidates := make([]stateHit, len(near))
	questions := map[string]decide.Question{}
	for i, hit := range near {
		candidates[i] = stateHit{N: i + 1, Kind: kindLabels[hit.Kind], Title: titleOr(hit.Title), Text: clip(hit.Content, 240)}
		questions[fmt.Sprintf("rel%d", i+1)] = decide.YesNo(
			fmt.Sprintf("Is candidate number %d about the same topic, project or piece of work as the open item, so the person would want it at hand?", i+1),
			"Yes, it is closely related", "No, it is only loosely similar or unrelated")
	}
	state := map[string]any{
		"open":       stateHit{Kind: kindLabels[kind], Title: titleOr(src.Title), Text: clip(src.Content, 600)},
		"candidates": candidates,
	}
	answers, err := s.decisions.Ask(ctx, userID, decide.Request{Feature: "search_related", State: state, Questions: questions})
	if err != nil {
		return out, nil
	}
	for i, hit := range near {
		if yes, sure := answers.Yes(fmt.Sprintf("rel%d", i+1), decide.Prefill); !sure || !yes {
			continue
		}
		out = append(out, RelatedItem{Kind: hit.Kind, ID: hit.EntityID, Title: titleOr(hit.Title), Snippet: snippet(hit.Content)})
		if len(out) == relatedShown {
			break
		}
	}
	return out, nil
}

// createVerbs and kindNouns are stripped from a command-like query to get a
// title: "make a budget sheet" -> "Budget".
var (
	createVerbs = map[string]bool{"make": true, "create": true, "new": true, "add": true, "start": true, "write": true, "draft": true, "plan": true, "set": true, "up": true, "schedule": true, "book": true}
	fillers     = map[string]bool{"a": true, "an": true, "the": true, "my": true, "me": true, "for": true, "to": true, "please": true, "called": true, "named": true}
	kindNouns   = map[string]bool{"sheet": true, "spreadsheet": true, "table": true, "doc": true, "document": true, "note": true, "notes": true, "page": true, "task": true, "todo": true, "to-do": true, "project": true, "event": true}
)

// createTitle turns a command-like query into the new item's title.
func createTitle(query, kind string) string {
	words := strings.Fields(query)
	start := 0
	for start < len(words) && (createVerbs[strings.ToLower(words[start])] || fillers[strings.ToLower(words[start])] || misspeltVerb(words, start)) {
		start++
	}
	end := len(words)
	for end > start && (kindNouns[strings.ToLower(words[end-1])] || fillers[strings.ToLower(words[end-1])]) {
		end--
	}
	// "a sheet for the budget": drop the noun and its filler at the front too.
	for start < end && (kindNouns[strings.ToLower(words[start])] || fillers[strings.ToLower(words[start])]) {
		start++
	}
	title := strings.TrimSpace(strings.Join(words[start:end], " "))
	if title == "" {
		return ""
	}
	r := []rune(title)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// misspeltVerb reports whether words[i] is a typo of a longer create verb
// ("creata", "crate") right before a filler or kind noun ("creata doc test").
// The next-word check keeps real words like "white paper" intact.
func misspeltVerb(words []string, i int) bool {
	if i+1 >= len(words) {
		return false
	}
	next := strings.ToLower(words[i+1])
	if !kindNouns[next] && !fillers[next] {
		return false
	}
	word := strings.ToLower(words[i])
	if len(word) < 4 {
		return false
	}
	for verb := range createVerbs {
		if len(verb) >= 5 && editDistance(word, verb) <= 1 {
			return true
		}
	}
	return false
}

// editDistance is the Levenshtein distance between two short words.
func editDistance(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	cur := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(rb)]
}

func titleOr(title string) string {
	if strings.TrimSpace(title) == "" {
		return "Untitled"
	}
	return title
}

func clip(text string, n int) string {
	text = strings.Join(strings.Fields(text), " ")
	r := []rune(text)
	if len(r) <= n {
		return text
	}
	return string(r[:n-1]) + "…"
}
