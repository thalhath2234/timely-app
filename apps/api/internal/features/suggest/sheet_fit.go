package suggest

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// Cell fit: after a person types a new entry into a text or select column
// whose header names a kind of thing ("Category", "Merchant", "City",
// "Status"), one question asks whether the entry is that kind of thing. A
// wrong type in a typed column (a date in a currency column) is arithmetic
// and never reaches here. The answer is only a hint the person can dismiss;
// the cell is never changed.

const (
	maxFitValues   = 200
	maxFitExamples = 8
	maxFitValueLen = 80
	minFitExamples = 2
)

// categoryWords are header words that name a kind of thing with a limited
// set of values. Free text columns (Notes, Description) never match.
var categoryWords = map[string]bool{
	"category": true, "type": true, "kind": true, "class": true, "group": true, "tag": true, "label": true,
	"merchant": true, "vendor": true, "shop": true, "store": true, "supplier": true, "seller": true, "payee": true,
	"brand": true, "company": true, "client": true, "customer": true, "employer": true,
	"city": true, "town": true, "country": true, "state": true, "region": true, "location": true, "place": true, "venue": true,
	"status": true, "stage": true, "phase": true, "priority": true, "department": true, "team": true, "role": true,
	"project": true, "account": true, "method": true, "payment": true, "channel": true, "source": true, "platform": true,
	"genre": true, "cuisine": true, "color": true, "colour": true, "size": true, "level": true, "unit": true,
	"currency": true, "language": true, "owner": true, "assignee": true, "frequency": true, "room": true,
}

var fitWord = regexp.MustCompile(`\p{L}+`)

// namesCategory reports whether a column header names a kind of thing.
func namesCategory(header string) bool {
	for _, w := range fitWord.FindAllString(strings.ToLower(header), -1) {
		if categoryWords[w] {
			return true
		}
		if strings.HasSuffix(w, "ies") && categoryWords[strings.TrimSuffix(w, "ies")+"y"] {
			return true
		}
		if strings.HasSuffix(w, "s") && categoryWords[strings.TrimSuffix(w, "s")] {
			return true
		}
	}
	return false
}

// CellFitInput is one edited cell: its column's header and type, the new
// entry, the column's other values and, for a select column, its options.
type CellFitInput struct {
	Column  string   `json:"column"`
	Type    string   `json:"type"`
	Value   string   `json:"value"`
	Values  []string `json:"values"`
	Options []string `json:"options,omitempty"`
}

// CellFit carries a hint when the entry may not fit its column.
type CellFit struct {
	Available bool   `json:"available"`
	LogID     string `json:"logId,omitempty"`
	Misfit    bool   `json:"misfit"`
	Hint      string `json:"hint,omitempty"`
}

func (s *Service) cellFit(c *echo.Context) error {
	var in CellFitInput
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Send a column, a value and some of its other values")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), sheetBudget)
	defer cancel()
	out, err := s.CellFit(ctx, user(c), in)
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// hasLetter is false for an entry that is only numbers and punctuation;
// masked, it would tell Jev nothing.
func hasLetter(v string) bool {
	for _, r := range v {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// fitExamples returns the column's other values (masked, distinct, at most
// eight) and whether the entry is already one of them.
func fitExamples(in CellFitInput, value string) ([]string, bool) {
	values := append(append([]string{}, in.Options...), in.Values...)
	if len(values) > maxFitValues {
		values = values[:maxFitValues]
	}
	seen := map[string]bool{}
	examples := []string{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		key := strings.ToLower(v)
		if v == "" || strings.HasPrefix(v, "=") || seen[key] {
			continue
		}
		if key == strings.ToLower(value) {
			return nil, true
		}
		seen[key] = true
		if len(examples) < maxFitExamples {
			examples = append(examples, anyDigits.ReplaceAllString(clip(v, 40), "#"))
		}
	}
	return examples, false
}

// anyDigits masks numbers the way receipt questions do.
var anyDigits = regexp.MustCompile(`\d+(?:[.,]\d+)*`)

// CellFit asks whether a new entry in a text or select column is the kind of
// thing the column holds. It asks nothing for typed columns, free text
// headers, an entry the column already has, or a column with fewer than two
// other values.
func (s *Service) CellFit(ctx context.Context, userID string, in CellFitInput) (CellFit, error) {
	on, _ := s.decide.Status(ctx, userID)
	out := CellFit{Available: on}
	if !on {
		return out, nil
	}
	kind, err := models.NormalizeSheetColumnType(in.Type)
	if err != nil {
		return out, nil
	}
	header := strings.TrimSpace(in.Column)
	value := strings.TrimSpace(in.Value)
	switch {
	case kind != models.SheetColumnTypeText && kind != models.SheetColumnTypeSelect,
		kind == models.SheetColumnTypeText && !namesCategory(header),
		header == "", value == "", strings.HasPrefix(value, "="),
		len([]rune(value)) > maxFitValueLen, !hasLetter(value):
		return out, nil
	}
	examples, known := fitExamples(in, value)
	if known || len(examples) < minFitExamples {
		return out, nil
	}
	state := map[string]any{
		"columnHeader": clip(header, 60),
		"otherValues":  examples,
		"newEntry":     anyDigits.ReplaceAllString(value, "#"),
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "sheet_cell_fit", State: state, Private: true,
		Questions: map[string]decide.Question{"fit": decide.Choice(
			"The person typed a new entry into a spreadsheet column. Is the new entry the same kind of thing the column header names and the other values are? A new value of the same kind (another shop in a Merchant column, another city in a City column) fits. Every number is shown as #.",
			decide.Option{Name: "fits", Description: "The new entry is the same kind of thing as the header and the other values, even if it is new."},
			decide.Option{Name: "misfit", Description: "The new entry is a different kind of thing, such as a city in a Category column, a person's note in a Status column, or a product in a Merchant column."},
		).Twice()}})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	if choice, ok := a.Choice("fit", decide.Flag); ok && choice == "misfit" {
		out.Misfit = true
		out.Hint = fmt.Sprintf("This may not fit the %s column.", clip(header, 40))
	}
	return out, nil
}
