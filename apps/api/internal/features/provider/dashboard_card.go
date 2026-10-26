package provider

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
)

// Described dashboard cards: "overdue client work and what's due this week"
// becomes an OpenUI Lang program the apps draw on the dashboard
// (packages/contract/src/genuiBoard.ts). The model writes the layout once;
// the program's @Data calls read the person's data in the app each time the
// dashboard shows, so the card never comes back here to stay current. Like
// Help me write it runs on the account's generative provider.

//go:embed board_prompt.txt
var boardPrompt string

const (
	dashboardCardMaxText    = 500
	dashboardCardMaxProgram = 8000
	dashboardCardBudget     = 90 * time.Second
)

type dashboardCardRequest struct {
	// Prompt is the person's words: what the card shows, or the change to make.
	Prompt string `json:"prompt"`
	// Today is the date in the Working hours timezone (YYYY-MM-DD).
	Today string `json:"today"`
	// Current is the card's program when the words change an existing card.
	Current string `json:"current"`
	// Place is "doc" for a live block in a doc; anything else is a dashboard card.
	Place string `json:"place"`
}

type dashboardCardResponse struct {
	Program  string `json:"program"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

func (s *Service) dashboardCard(c *echo.Context) error {
	var req dashboardCardRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	answer, err := s.describeCard(c.Request().Context(), user(c), req)
	if err != nil {
		return err
	}
	return c.JSON(200, answer)
}

// LiveBlock writes a live block's program for a doc from the person's words,
// or changes the current one, as the apps' Describe dialog does; the agent's
// add_live_block tool calls it. today is YYYY-MM-DD in the person's zone.
func (s *Service) LiveBlock(ctx context.Context, userID, words, current, today string) (string, error) {
	answer, err := s.describeCard(ctx, userID, dashboardCardRequest{Prompt: words, Current: current, Place: "doc", Today: today})
	if err != nil {
		var he *echo.HTTPError
		if errors.As(err, &he) {
			return "", errors.New(fmt.Sprint(he.Message))
		}
		return "", err
	}
	return answer.Program, nil
}

func (s *Service) describeCard(ctx context.Context, userID string, req dashboardCardRequest) (dashboardCardResponse, error) {
	req.Prompt = clipHead(strings.TrimSpace(req.Prompt), dashboardCardMaxText)
	if req.Prompt == "" {
		return dashboardCardResponse{}, echo.NewHTTPError(400, "Say what the card should show")
	}
	req.Current = strings.TrimSpace(req.Current)
	if len(req.Current) > dashboardCardMaxProgram {
		req.Current = ""
	}
	if _, err := time.Parse("2006-01-02", req.Today); err != nil {
		req.Today = time.Now().Format("2006-01-02")
	}
	row, err := s.load(s.db, userID)
	if err != nil {
		return dashboardCardResponse{}, err
	}
	provider := writeProvider(s.view(ctx, row, time.Minute))
	if provider == "" {
		return dashboardCardResponse{}, echo.NewHTTPError(409, "Describing cards needs an AI provider. Add a key in Settings → Agent keys")
	}
	completer, err := s.Completer(ctx, userID, provider, "")
	if err != nil {
		return dashboardCardResponse{}, echo.NewHTTPError(409, err.Error())
	}
	vocab, err := s.loadViewVocab(ctx, userID)
	if err != nil {
		return dashboardCardResponse{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, dashboardCardBudget)
	defer cancel()
	reply, err := completer.Complete(ctx, dashboardCardMessages(req, vocab), nil, false)
	if err != nil {
		return dashboardCardResponse{}, echo.NewHTTPError(502, err.Error())
	}
	program, err := boardProgram(reply.Content)
	if err != nil {
		return dashboardCardResponse{}, echo.NewHTTPError(502, "The AI's answer was not a card. Try again")
	}
	_, model, _ := s.resolveModel(ctx, userID, provider)
	return dashboardCardResponse{Program: program, Provider: provider, Model: model}, nil
}

func dashboardCardMessages(req dashboardCardRequest, v viewVocab) []chat.WireMessage {
	var b strings.Builder
	weekday := ""
	if day, err := time.Parse("2006-01-02", req.Today); err == nil {
		weekday = day.Weekday().String()
	}
	fmt.Fprintf(&b, "Today is %s %s.\n\nThe person's names:\n", weekday, req.Today)
	list := func(title string, rows []vocabRow) {
		if names := uniqueNames(rows); len(names) > 0 {
			fmt.Fprintf(&b, "- %s: %s\n", title, strings.Join(names, ", "))
		}
	}
	list("Workspaces", v.workspaces)
	list("Projects", v.projects)
	list("Statuses", v.statuses)
	list("Labels", v.labels)
	if req.Place == "doc" {
		b.WriteString("\nThis card is a live block in a doc: it takes the doc's width and as much height as it needs, so leave the size out. Up to ten rows fit.\n")
	}
	if req.Current != "" {
		fmt.Fprintf(&b, "\nThe card now:\n<program>\n%s\n</program>\n\nChange it: %s\n", req.Current, req.Prompt)
	} else {
		fmt.Fprintf(&b, "\nWords: %s\n", req.Prompt)
	}
	return []chat.WireMessage{{Role: "system", Content: boardPrompt}, {Role: "user", Content: b.String()}}
}

var (
	programFence = regexp.MustCompile("(?s)```[\\w-]*[ \\t]*\\n(.*?)(?:\\n```|$)")
	programRoot  = regexp.MustCompile(`(?m)^root\s*=\s*Panel\(`)
)

// boardProgram takes the program out of the model's answer: inside a code
// fence when there is one, from the `root = Panel(` line on.
func boardProgram(answer string) (string, error) {
	text := cleanWritten(answer)
	if match := programFence.FindStringSubmatch(text); match != nil {
		text = match[1]
	}
	loc := programRoot.FindStringIndex(text)
	if loc == nil {
		return "", errors.New("no Panel root in the answer")
	}
	program := strings.TrimSpace(text[loc[0]:])
	if len(program) > dashboardCardMaxProgram {
		return "", errors.New("the program is too long")
	}
	return program, nil
}
