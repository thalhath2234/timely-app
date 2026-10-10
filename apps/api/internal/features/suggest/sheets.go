package suggest

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// Sheet suggestions: which saved template a new sheet's title calls for, and
// what kind of values each column of an imported CSV holds. Both only
// pre-fill: the template picker the person can change, and column types
// limited to the ones every value already fits.

const (
	sheetBudget       = 3 * time.Second
	maxTemplates      = 40
	maxImportColumns  = 60
	maxColumnSamples  = 200
	maxSelectOptions  = 12
	maxSelectValueLen = 40
)

func (s *Service) sheetRoutes(g *echo.Group) {
	g.GET("/suggestions/sheet-template", s.sheetTemplate)
	g.POST("/suggestions/column-types", s.columnTypes)
	g.POST("/suggestions/cell-fit", s.cellFit)
}

// TemplateSuggestion names the saved template a new sheet probably wants.
type TemplateSuggestion struct {
	Available  bool   `json:"available"`
	LogID      string `json:"logId,omitempty"`
	TemplateID string `json:"templateId,omitempty"`
}

func (s *Service) sheetTemplate(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), sheetBudget)
	defer cancel()
	out, err := s.SheetTemplate(ctx, user(c), c.QueryParam("title"))
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// SheetTemplate asks which of the person's saved templates fits a sheet with
// this title, or none.
func (s *Service) SheetTemplate(ctx context.Context, userID, title string) (TemplateSuggestion, error) {
	on, _ := s.decide.Status(ctx, userID)
	out := TemplateSuggestion{Available: on}
	title = strings.TrimSpace(title)
	if !on || len([]rune(title)) < 2 {
		return out, nil
	}
	var templates []models.SheetTemplate
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).Order("updated_at DESC").Limit(maxTemplates).Find(&templates).Error; err != nil {
		return out, err
	}
	if len(templates) == 0 {
		return out, nil
	}
	options := make([]decide.Option, 0, len(templates)+1)
	for i, t := range templates {
		options = append(options, decide.Option{Name: fmt.Sprintf("t%d", i+1), Description: templateText(t)})
	}
	options = append(options, decide.Option{Name: "none", Description: "A blank sheet; none of these templates fits"})
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "sheet_template", State: map[string]string{"newSheetTitle": clip(title, 200)},
		Questions: map[string]decide.Question{"template": decide.Choice("The person is creating a new sheet with this title. Which of their saved sheet templates should it start from?", options...)}})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	choice, ok := a.Choice("template", decide.Prefill)
	var n int
	if ok && choice != "none" {
		if _, err := fmt.Sscanf(choice, "t%d", &n); err == nil && n >= 1 && n <= len(templates) {
			out.TemplateID = templates[n-1].ID
		}
	}
	return out, nil
}

// templateText describes a template by its name, tabs and column names.
func templateText(t models.SheetTemplate) string {
	text := fmt.Sprintf("Template “%s”", clip(t.Name, 80))
	names := func(cols models.SheetColumns) string {
		list := []string{}
		for _, c := range cols {
			if len(list) == 12 {
				break
			}
			if n := strings.TrimSpace(c.Name); n != "" {
				list = append(list, clip(n, 30))
			}
		}
		return strings.Join(list, ", ")
	}
	if len(t.Tabs) > 0 {
		tabs := []string{}
		for _, tab := range t.Tabs {
			if len(tabs) == 6 {
				break
			}
			tabs = append(tabs, fmt.Sprintf("“%s” (%s)", clip(tab.Name, 40), names(tab.Columns)))
		}
		return text + " with tabs " + strings.Join(tabs, "; ")
	}
	if cols := names(t.Columns); cols != "" {
		text += " with columns " + cols
	}
	return text
}

// ImportColumn is one column of an imported CSV: its header and some values.
type ImportColumn struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

// ColumnType is a suggested type for one imported column; Options lists a
// select column's choices in first-seen order.
type ColumnType struct {
	Type    string   `json:"type"`
	Options []string `json:"options,omitempty"`
}

// ColumnTypes holds one entry per imported column, nil where the column
// stays text.
type ColumnTypes struct {
	Available bool          `json:"available"`
	LogID     string        `json:"logId,omitempty"`
	Columns   []*ColumnType `json:"columns"`
}

func (s *Service) columnTypes(c *echo.Context) error {
	var in struct {
		Columns []ImportColumn `json:"columns"`
	}
	if err := c.Bind(&in); err != nil || len(in.Columns) > maxImportColumns {
		return echo.NewHTTPError(400, "Send at most 60 columns")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), sheetBudget)
	defer cancel()
	out, err := s.ColumnTypes(ctx, user(c), in.Columns)
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// typeWords explain each type to Jev.
var typeWords = map[string]string{
	models.SheetColumnTypeText:     "Free text, names, codes or identifiers (such as postcodes, phone numbers or order numbers) that are not used in arithmetic",
	models.SheetColumnTypeNumber:   "A plain quantity or count used in arithmetic",
	models.SheetColumnTypeCurrency: "A money amount: a price, cost, payment or balance",
	models.SheetColumnTypePercent:  "A percentage or rate",
	models.SheetColumnTypeDate:     "A calendar date",
	models.SheetColumnTypeBoolean:  "A yes/no or true/false flag",
	models.SheetColumnTypeSelect:   "One of a small fixed set of labels, such as a status or a category",
}

// plainNumber is a number written the one way that reads the same everywhere:
// an optional sign, comma thousands groups and a decimal point. A decimal
// comma (12,50) or a leading zero (02134, a code) stays text. The client
// checks every row against the same pattern (packages/contract sheetCsv.ts).
var plainNumber = regexp.MustCompile(`^[-+]?(0|[1-9]\d{0,2}(,\d{3})+|[1-9]\d*)(\.\d+)?$`)

// candidates lists the types every value of a column already fits, besides
// text. Dates count only in YYYY-MM-DD, so a day/month order is never
// guessed; 1 and 0 read as numbers, not yes/no.
func candidates(values []string) ([]string, []string) {
	filled := []string{}
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" {
			filled = append(filled, v)
		}
	}
	if len(filled) == 0 {
		return nil, nil
	}
	fits := func(check func(string) bool) bool {
		for _, v := range filled {
			if !check(v) {
				return false
			}
		}
		return true
	}
	isNumber := func(v string) bool {
		return plainNumber.MatchString(v) && models.NormalizeTypedCell(models.SheetColumnTypeNumber, v) != ""
	}
	out := []string{}
	// A percent column stores fractions (12% is 0.12), so only values written
	// with % can become one.
	if fits(isNumber) {
		out = append(out, models.SheetColumnTypeNumber, models.SheetColumnTypeCurrency)
	} else if fits(func(v string) bool {
		return strings.HasSuffix(v, "%") && plainNumber.MatchString(strings.TrimSpace(strings.TrimSuffix(v, "%"))) &&
			models.NormalizeTypedCell(models.SheetColumnTypePercent, v) != ""
	}) {
		out = append(out, models.SheetColumnTypePercent)
	}
	if fits(func(v string) bool {
		_, err := time.Parse("2006-01-02", v)
		return err == nil
	}) {
		out = append(out, models.SheetColumnTypeDate)
	}
	if fits(func(v string) bool {
		switch strings.ToUpper(v) {
		case "TRUE", "FALSE", "YES", "NO", "Y", "N":
			return true
		}
		return false
	}) {
		out = append(out, models.SheetColumnTypeBoolean)
	}
	var options []string
	seen := map[string]bool{}
	for _, v := range filled {
		if len([]rune(v)) > maxSelectValueLen {
			options = nil
			break
		}
		if !seen[v] {
			seen[v] = true
			options = append(options, v)
		}
	}
	if len(options) >= 2 && len(options) <= maxSelectOptions && len(filled) >= 2*len(options) && len(out) == 0 {
		out = append(out, models.SheetColumnTypeSelect)
	} else {
		options = nil
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, options
}

// ColumnTypes suggests a type for each imported column that could be more
// than text. Jev picks among the types the values allow, or keeps text.
func (s *Service) ColumnTypes(ctx context.Context, userID string, columns []ImportColumn) (ColumnTypes, error) {
	on, _ := s.decide.Status(ctx, userID)
	out := ColumnTypes{Available: on, Columns: make([]*ColumnType, len(columns))}
	if !on {
		return out, nil
	}
	described := []map[string]any{}
	questions := map[string]decide.Question{}
	selects := map[int][]string{}
	for i, col := range columns {
		values := col.Values
		if len(values) > maxColumnSamples {
			values = values[:maxColumnSamples]
		}
		types, options := candidates(values)
		if len(types) == 0 {
			continue
		}
		examples := []string{}
		seen := map[string]bool{}
		for _, v := range values {
			if v = strings.TrimSpace(v); v != "" && !seen[v] && len(examples) < 5 {
				seen[v] = true
				examples = append(examples, clip(v, 40))
			}
		}
		number := i + 1
		described = append(described, map[string]any{"column": number, "header": clip(strings.TrimSpace(col.Name), 60), "examples": examples})
		opts := []decide.Option{{Name: models.SheetColumnTypeText, Description: typeWords[models.SheetColumnTypeText]}}
		for _, t := range types {
			opts = append(opts, decide.Option{Name: t, Description: typeWords[t]})
		}
		if options != nil {
			selects[i] = options
		}
		questions[fmt.Sprintf("c%d", number)] = decide.Choice(fmt.Sprintf("What kind of values does imported column %d hold?", number), opts...)
	}
	if len(questions) == 0 {
		return out, nil
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "sheet_column_types", State: map[string]any{"importedColumns": described}, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	for i := range columns {
		choice, ok := a.Choice(fmt.Sprintf("c%d", i+1), decide.Prefill)
		if !ok || choice == models.SheetColumnTypeText {
			continue
		}
		t := &ColumnType{Type: choice}
		if choice == models.SheetColumnTypeSelect {
			t.Options = selects[i]
		}
		out.Columns[i] = t
	}
	return out, nil
}
