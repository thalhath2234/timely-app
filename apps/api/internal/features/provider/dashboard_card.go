package provider

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/sheet"
	"timely-api/internal/models"
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
	// dashboardCardBudget covers the look-ups, checks and the answer.
	dashboardCardBudget = 3 * time.Minute
	// dashboardCardTurns caps the model's calls in one Describe.
	dashboardCardTurns = 10
	// dashboardCardAnswer is the time kept for the answer: with less left,
	// the model is told to answer now.
	dashboardCardAnswer = 45 * time.Second
	// dashboardCardSheets is how many sheets, latest edited first, the model
	// is told the tabs and columns of.
	dashboardCardSheets = 12
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
	noun := "card"
	if req.Place == "doc" {
		noun = "block"
	}
	req.Prompt = clipHead(strings.TrimSpace(req.Prompt), dashboardCardMaxText)
	if req.Prompt == "" {
		return dashboardCardResponse{}, echo.NewHTTPError(400, "Say what the "+noun+" should show")
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
		need := "Describing cards needs"
		if req.Place == "doc" {
			need = "Live blocks need"
		}
		return dashboardCardResponse{}, echo.NewHTTPError(409, need+" an AI provider. Add a key in Settings → Agent keys")
	}
	completer, err := s.Completer(ctx, userID, provider, "")
	if err != nil {
		return dashboardCardResponse{}, echo.NewHTTPError(409, err.Error())
	}
	vocab, err := s.loadViewVocab(ctx, userID)
	if err != nil {
		return dashboardCardResponse{}, err
	}
	sheets, err := s.sheetBriefs(ctx, userID)
	if err != nil {
		return dashboardCardResponse{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, dashboardCardBudget)
	defer cancel()
	messages := dashboardCardMessages(req, vocab, sheets)
	tools := s.tools(ctx, userID)
	if tools != nil {
		messages[0].Content += describeToolsNote
	}
	program, err := describe(ctx, completer, messages, tools)
	if errors.Is(err, errNotACard) {
		return dashboardCardResponse{}, echo.NewHTTPError(502, "The AI's answer was not a "+noun+". Try again")
	}
	if err != nil {
		return dashboardCardResponse{}, echo.NewHTTPError(502, err.Error())
	}
	_, model, _ := s.resolveModel(ctx, userID, provider)
	return dashboardCardResponse{Program: program, Provider: provider, Model: model}, nil
}

var errNotACard = errors.New("the answer holds no program")

// describe asks the model for the program. With tools it may read the
// person's data and check drafts first; its answer is drawn once more, and
// one with problems goes back to the model a single time to be fixed. A
// model that runs out of turns, or never writes the program out, gets the
// last draft it checked.
func describe(ctx context.Context, completer chat.Completer, messages []chat.WireMessage, tools *describeTools) (string, error) {
	var specs []any
	if tools != nil {
		specs = tools.specs
	}
	deadline, timed := ctx.Deadline()
	sentBack, nudged, told := false, false, false
	for turn := 0; turn < dashboardCardTurns; turn++ {
		last := turn == dashboardCardTurns-1 || (timed && time.Until(deadline) < dashboardCardAnswer)
		if last && len(specs) > 0 && turn > 0 && !told {
			// The tools stay listed: some providers refuse a transcript with
			// tool calls in it once the tools are gone.
			messages = append(messages, chat.WireMessage{Role: "user", Content: "Time is up for look-ups: answer now with the whole program and no tool calls."})
			told = true
		}
		reply, err := completer.Complete(ctx, messages, specs, false)
		if err != nil {
			return "", err
		}
		if len(reply.ToolCalls) == 0 || tools == nil {
			program, err := boardProgram(reply.Content)
			if err != nil {
				if draft := tools.fallback(); draft != "" && (nudged || last) {
					return draft, nil
				}
				if nudged || last {
					return "", errNotACard
				}
				nudged = true
				messages = append(messages, reply, chat.WireMessage{Role: "user", Content: "Answer with the program only: the whole OpenUI Lang program from the root = Panel(...) line on."})
				continue
			}
			if tools != nil && tools.load != nil && !sentBack && !last {
				if checked, err := tools.check(ctx, program); err == nil && len(checked.Problems) > 0 {
					sentBack = true
					messages = append(messages, reply, chat.WireMessage{Role: "user", Content: "Timely drew this program from the person's data and found problems:\n- " + strings.Join(checked.Problems, "\n- ") + "\nFix them and answer with the whole program again. When one can't be fixed, leave that part out."})
					continue
				}
			}
			return program, nil
		}
		if last {
			break
		}
		messages = append(messages, reply)
		for _, call := range reply.ToolCalls {
			messages = append(messages, chat.WireMessage{Role: "tool", ToolCallID: call.ID, Content: tools.call(ctx, call)})
		}
	}
	if draft := tools.fallback(); draft != "" {
		return draft, nil
	}
	return "", errors.New("The AI took too many steps. Try again, or say more exactly what to show")
}

// sheetBrief is one sheet as the model sees it for @Cells.
type sheetBrief struct {
	Title string
	Tabs  []sheet.CellsTab
}

// sheetBriefs reads the person's latest edited sheets and works out, with the
// apps' own engine, the column names their @Cells calls find.
func (s *Service) sheetBriefs(ctx context.Context, userID string) ([]sheetBrief, error) {
	var sheets []models.Sheet
	err := s.db.WithContext(ctx).Where("user_id = ? AND archived_at IS NULL", userID).Order("updated_at DESC").Limit(dashboardCardSheets).Find(&sheets).Error
	if err != nil || len(sheets) == 0 {
		return nil, err
	}
	tabs, err := sheet.CellsBriefs(sheets)
	if err != nil {
		// A workbook the engine can't read costs the model its sheets, not the card.
		return nil, nil
	}
	briefs := make([]sheetBrief, 0, len(sheets))
	for i, each := range sheets {
		if i < len(tabs) {
			briefs = append(briefs, sheetBrief{Title: each.Title, Tabs: tabs[i]})
		}
	}
	return briefs, nil
}

// writeSheets lists sheets for @Cells: each tab with its columns, numbers
// marked, and the values of columns that hold a few, which `is` must match.
func writeSheets(b *strings.Builder, sheets []sheetBrief) {
	wrote := false
	for _, sh := range sheets {
		title := strings.TrimSpace(sh.Title)
		if title == "" {
			continue
		}
		var tabs []string
		for _, tab := range sh.Tabs {
			if tab.Rows == 0 || len(tab.Columns) == 0 {
				continue
			}
			columns := make([]string, len(tab.Columns))
			for i, column := range tab.Columns {
				columns[i] = column.Name
				if column.Numbers {
					columns[i] += " #"
				} else if len(column.Values) > 0 {
					values := make([]string, len(column.Values))
					for j, value := range column.Values {
						values[j] = strconv.Quote(value)
					}
					columns[i] += " [" + strings.Join(values, ", ") + "]"
				}
			}
			tabs = append(tabs, fmt.Sprintf("  - tab %q, %d rows: %s", tab.Name, tab.Rows, strings.Join(columns, ", ")))
		}
		if len(tabs) == 0 {
			continue
		}
		if !wrote {
			b.WriteString("\nThe person's sheets, for @Cells (each tab with its columns; # marks columns of numbers; [...] lists the values a column of text holds, written as is must write them):\n")
			wrote = true
		}
		fmt.Fprintf(b, "- %q\n%s\n", title, strings.Join(tabs, "\n"))
	}
}

func dashboardCardMessages(req dashboardCardRequest, v viewVocab, sheets []sheetBrief) []chat.WireMessage {
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
	writeSheets(&b, sheets)
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
