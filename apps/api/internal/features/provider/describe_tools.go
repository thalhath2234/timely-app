package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/chat"
	"timely-api/internal/models"
)

// The Describe AI's tools. Dashboard cards, doc live blocks and the agent's
// add_live_block all come from describeCard, which used to see only the
// person's names and sheet columns. With these it reads the person's data
// through the chat agent's read tools first, and draws each draft from that
// data with check_block, so a filter that fits nothing or an empty chart is
// fixed before the person sees the card. The card itself still reads its
// data through @Data and @Cells each time it shows.

// BoardData loads what the apps' dashboards read for one account, in the
// shapes of their REST calls: the contract's DashboardData.
type BoardData func(ctx context.Context, userID string) (any, error)

// SetReadTools gives Describe the chat agent's read tools; tools builds the
// agent's catalog over a database handle, as for chat.
func (s *Service) SetReadTools(tools func(*gorm.DB) agent.Catalog) { s.readTools = tools }

// SetBoardData lets Describe draw its drafts from the person's data.
func (s *Service) SetBoardData(load BoardData) { s.boardData = load }

const (
	checkBlockTool = "check_block"
	// describeResultMax is the most a tool result may hand the model, as in chat.
	describeResultMax = 90000
)

const describeToolsNote = `

## Looking things up
You have tools that read the person's data as it is now, and check_block, which draws a program from that data. Use them before you answer:
- When the words are about something the person's names below don't settle, read it: list_projects, list_tasks, list_events, list_sheets, get_sheet_values, search and the other read tools. Find the exact project, label or status name, the sheet, tab and column that hold the numbers, and the values a column holds.
- Write the program, then call check_block with it. It returns what every block shows and any problems. When there are problems, a list is empty or a number is 0 where the words expect data, fix the program and check it again.
- Then answer with the program only, as above. The tools only read: the card still gets every number from @Data or @Cells each time it shows, never from what a tool returned.`

// describeTools is one Describe's tools: the read tools and check_block,
// whose data is loaded on the first check and kept for the rest.
type describeTools struct {
	userID  string
	catalog agent.Catalog
	load    BoardData
	zone    string
	specs   []any
	data    json.RawMessage
	// checked keeps each program's drawing: the answer is often the draft
	// the model last checked.
	checked map[string]boardCheck
	// drafted is the latest checked program, clean the latest without
	// problems: the answer when the model runs out of turns without one.
	drafted, clean string
}

// fallback is the draft to answer with when the model gives none: the
// latest that drew without problems, else the latest.
func (t *describeTools) fallback() string {
	if t == nil {
		return ""
	}
	if t.clean != "" {
		return t.clean
	}
	return t.drafted
}

// tools offers what this server has: nil when neither the read tools nor
// the board data are set, which leaves Describe one-shot.
func (s *Service) tools(ctx context.Context, userID string) *describeTools {
	if s.readTools == nil && s.boardData == nil {
		return nil
	}
	var catalog agent.Catalog
	if s.readTools != nil {
		catalog = s.readTools(s.db.WithContext(ctx))
	}
	zone := ""
	if s.boardData != nil {
		if hours, err := models.LoadWorkingHours(s.db.WithContext(ctx), userID); err == nil {
			zone = hours.Timezone
		}
	}
	return newDescribeTools(userID, catalog, s.boardData, zone)
}

// newDescribeTools lists the catalog's read tools, then check_block when
// there is data to draw from; zone is the Working hours timezone.
func newDescribeTools(userID string, catalog agent.Catalog, load BoardData, zone string) *describeTools {
	t := &describeTools{userID: userID, catalog: catalog, load: load, zone: zone}
	names := make([]string, 0, len(catalog))
	for name, tool := range catalog {
		if isReadTool(name) && tool.Call != nil {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		t.specs = append(t.specs, toolSpec(name, catalog[name].Description, catalog[name].Parameters))
	}
	if load != nil {
		t.specs = append(t.specs, toolSpec(checkBlockTool, "Draw a draft program from the person's data as Timely will show it. Returns what every block shows (numbers, rows, bars) and the problems to fix, such as a name that fits nothing. Check each draft before you answer with it.", map[string]any{
			"type":       "object",
			"properties": map[string]any{"program": map[string]any{"type": "string", "description": "The whole OpenUI Lang program, from the root = Panel(...) line on."}},
			"required":   []string{"program"},
		}))
	}
	return t
}

func isReadTool(name string) bool {
	authority, ok := agent.AuthorityOf(name)
	return ok && authority.Access == agent.Read
}

func toolSpec(name, desc string, params any) any {
	return map[string]any{"type": "function", "function": map[string]any{"name": name, "description": desc, "parameters": params}}
}

// call runs one tool call and returns its result for the model, an error
// object when it fails.
func (t *describeTools) call(ctx context.Context, call chat.ToolCall) string {
	name := call.Function.Name
	args := json.RawMessage(call.Function.Arguments)
	if strings.TrimSpace(call.Function.Arguments) == "" {
		args = json.RawMessage("{}")
	}
	var result any
	var err error
	switch {
	case name == checkBlockTool && t.load != nil:
		var in struct {
			Program string `json:"program"`
		}
		if err = json.Unmarshal(args, &in); err == nil {
			result, err = t.check(ctx, in.Program)
		}
	case isReadTool(name) && t.catalog[name].Call != nil:
		result, err = t.catalog[name].Call(ctx, t.userID, args)
	default:
		err = fmt.Errorf("unknown tool %q: use only the listed tools, then answer with the program", name)
	}
	if err != nil {
		result = map[string]any{"error": err.Error()}
	}
	encoded, _ := json.Marshal(result)
	if len(encoded) > describeResultMax {
		encoded, _ = json.Marshal(map[string]any{"error": "Result is too large; narrow the filters, page with limit and offset, or fetch a specific object"})
	}
	return string(encoded)
}

// check draws program from the person's data, loading it on the first check.
func (t *describeTools) check(ctx context.Context, program string) (boardCheck, error) {
	program = strings.TrimSpace(program)
	if program == "" {
		return boardCheck{}, errors.New("pass the whole program")
	}
	if len(program) > dashboardCardMaxProgram {
		return boardCheck{}, errors.New("the program is too long")
	}
	if done, ok := t.checked[program]; ok {
		return done, nil
	}
	if t.data == nil {
		data, err := t.load(ctx, t.userID)
		if err != nil {
			return boardCheck{}, err
		}
		if t.data, err = json.Marshal(data); err != nil {
			return boardCheck{}, err
		}
	}
	done, err := checkBoard(program, t.data, time.Now(), t.zone)
	if err != nil {
		return boardCheck{}, err
	}
	if t.checked == nil {
		t.checked = map[string]boardCheck{}
	}
	t.checked[program] = done
	if draft, err := boardProgram(program); err == nil {
		t.drafted = draft
		if len(done.Problems) == 0 {
			t.clean = draft
		}
	}
	return done, nil
}
