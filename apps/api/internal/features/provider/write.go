package provider

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
)

// Help me write: one-shot drafting for docs and task or project descriptions.
// It runs on the account's generative provider (Settings → Agent keys), never
// on TypeSafe, which only answers typed questions.

// writeActions maps each action to the instruction the model gets. "write"
// and the actions that need a selection are checked in writeRequest.validate.
var writeActions = map[string]string{
	"write":     "Write what the user asks for.",
	"continue":  "Continue the text from where it ends. Match its voice, language and formatting, and do not repeat what is already there.",
	"describe":  "Write a short, useful description for this item from its title and any notes: what it is, why it matters and what done looks like. Use a few short paragraphs or a short checklist of steps, whichever fits.",
	"improve":   "Rewrite the selected text so it reads clearly and naturally. Keep its meaning, facts, language and formatting.",
	"shorter":   "Rewrite the selected text so it is noticeably shorter. Keep the key points and its language.",
	"longer":    "Expand the selected text with useful detail. Keep its meaning, voice and language.",
	"fix":       "Fix spelling, grammar and punctuation in the selected text. Change nothing else.",
	"steps":     "Turn the selected text into a Markdown checklist of clear, actionable steps (\"- [ ] ...\").",
	"summarize": "Summarize the text in a few short bullet points.",
}

const writeSystem = `You are the writing helper inside Timely, a planner with tasks, projects and docs.
Reply with only the text to put into the editor, as Markdown: headings, lists, "- [ ]" checklists, tables, bold and links are all fine.
No preamble, no closing remarks, no notes about what you changed, and do not wrap the answer in a code block.
Write in the language of the user's text unless they ask for another one.
The current text is context: do not repeat it in your answer unless the task is to rewrite it.`

const (
	writeMaxText      = 12000
	writeMaxSelection = 8000
	writeMaxPrompt    = 2000
)

type writeRequest struct {
	Action    string `json:"action"`
	Prompt    string `json:"prompt"`
	Selection string `json:"selection"`
	// Kind is "doc", "task" or "project"; Title and Text describe what is open.
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

type writeResponse struct {
	Text     string `json:"text"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

func (r *writeRequest) validate() error {
	r.Action = strings.TrimSpace(r.Action)
	if r.Action == "" {
		r.Action = "write"
	}
	if _, ok := writeActions[r.Action]; !ok {
		return fmt.Errorf("Unknown writing action %q", r.Action)
	}
	r.Prompt = clipHead(strings.TrimSpace(r.Prompt), writeMaxPrompt)
	r.Selection = clipHead(strings.TrimSpace(r.Selection), writeMaxSelection)
	r.Title = clipHead(strings.TrimSpace(r.Title), 300)
	r.Text = clipTail(strings.TrimSpace(r.Text), writeMaxText)
	switch r.Action {
	case "write":
		if r.Prompt == "" {
			return fmt.Errorf("Say what to write")
		}
	case "improve", "shorter", "longer", "fix", "steps":
		if r.Selection == "" {
			return fmt.Errorf("Select some text first")
		}
	case "continue":
		if r.Text == "" {
			return fmt.Errorf("There is nothing to continue yet")
		}
	case "summarize":
		if r.Selection == "" && r.Text == "" {
			return fmt.Errorf("There is nothing to summarize yet")
		}
	case "describe":
		if r.Title == "" && r.Text == "" {
			return fmt.Errorf("Give it a title first")
		}
	}
	return nil
}

// writeMessages builds the system and user turns for one request.
func writeMessages(r writeRequest) []chat.WireMessage {
	kind := map[string]string{"doc": "doc", "task": "task description", "project": "project description"}[r.Kind]
	if kind == "" {
		kind = "doc"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Task: %s\n", writeActions[r.Action])
	if r.Kind == "task" || r.Kind == "project" {
		b.WriteString("Keep it compact: this goes into a description field, not a long document.\n")
	}
	fmt.Fprintf(&b, "\nThe user is editing a %s", kind)
	if r.Title != "" {
		fmt.Fprintf(&b, " titled %q", r.Title)
	}
	b.WriteString(".\n")
	if r.Text != "" && !(r.Action == "summarize" && r.Selection != "") {
		fmt.Fprintf(&b, "\n<current_text>\n%s\n</current_text>\n", r.Text)
	}
	if r.Selection != "" {
		fmt.Fprintf(&b, "\n<selected_text>\n%s\n</selected_text>\n", r.Selection)
		if !strings.Contains(r.Selection, "\n") && (r.Action == "improve" || r.Action == "shorter" || r.Action == "longer" || r.Action == "fix") {
			b.WriteString("The selection is a single line, so answer with a single paragraph: no headings, list markers or checkboxes.\n")
		}
	}
	if r.Prompt != "" {
		fmt.Fprintf(&b, "\n<request>\n%s\n</request>\n", r.Prompt)
	}
	return []chat.WireMessage{{Role: "system", Content: writeSystem}, {Role: "user", Content: b.String()}}
}

var wholeFence = regexp.MustCompile("(?s)^```[a-zA-Z]*\\n(.*)\\n```$")

// cleanWritten drops a code fence wrapped around the whole answer, which some
// models add despite being told not to.
func cleanWritten(s string) string {
	s = strings.TrimSpace(s)
	if m := wholeFence.FindStringSubmatch(s); m != nil {
		s = strings.TrimSpace(m[1])
	}
	return s
}

func clipHead(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.ToValidUTF8(s[:n], "")
}

// clipTail keeps the end of a long text, which is what "continue" needs.
func clipTail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.ToValidUTF8(s[len(s)-n:], "")
}

// writeProvider picks the account default when it is ready, otherwise the
// first ready provider in the order the model menu lists them.
func writeProvider(o overview) string {
	ready := []string{}
	if o.OpenRouter.Ready {
		ready = append(ready, OpenRouter)
	}
	if o.LocalCLI && o.Claude.Ready {
		ready = append(ready, ClaudeCLI)
	}
	if o.LocalCLI && o.Codex.Ready {
		ready = append(ready, CodexCLI)
	}
	for _, api := range o.APIs {
		if api.Ready {
			ready = append(ready, api.ID)
		}
	}
	for _, id := range ready {
		if id == o.DefaultProvider {
			return id
		}
	}
	if len(ready) > 0 {
		return ready[0]
	}
	return ""
}

func (s *Service) write(c *echo.Context) error {
	var req writeRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	if err := req.validate(); err != nil {
		return echo.NewHTTPError(400, err.Error())
	}
	ctx := c.Request().Context()
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	provider := writeProvider(s.view(ctx, row, time.Minute))
	if provider == "" {
		return echo.NewHTTPError(409, "Help me write needs an AI provider. Add a key in Settings → Agent keys")
	}
	completer, err := s.Completer(ctx, user(c), provider, "")
	if err != nil {
		return echo.NewHTTPError(409, err.Error())
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	reply, err := completer.Complete(ctx, writeMessages(req), nil, false)
	if err != nil {
		return echo.NewHTTPError(502, err.Error())
	}
	text := cleanWritten(reply.Content)
	if text == "" {
		return echo.NewHTTPError(502, "The AI returned an empty answer. Try again")
	}
	_, model, _ := s.resolveModel(ctx, user(c), provider)
	return c.JSON(200, writeResponse{Text: text, Provider: provider, Model: model})
}

// resolveModel reports the model a provider runs for this account.
func (s *Service) resolveModel(ctx context.Context, userID, provider string) (string, string, error) {
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return provider, "", err
	}
	if spec := apiProviderByID(provider); spec != nil {
		api, _, err := s.apiRow(s.db.WithContext(ctx), userID, provider)
		return provider, api.Model, err
	}
	return provider, s.chatModel(row, provider), nil
}
