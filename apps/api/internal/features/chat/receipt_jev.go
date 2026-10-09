package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"timely-api/internal/features/decide"
	"timely-api/internal/features/sheet"
	"timely-api/internal/models"
)

// Jev on receipts (ADR 0012). It sees only short fields a question needs
// (merchant, item names, the person's category, sheet and column names),
// never the photos or the extracted text, and over OpenRouter only
// zero-data-retention endpoints (decide.Request.Private). Its answers become
// hints on the review, a pre-filled category the person can change, a
// pre-selected destination, a skipped model call for a message that changes
// nothing, or an existing column a field is written to. Amounts, totals and
// reconciliation stay in code. With suggestions off nothing is asked and
// receipts work as before.

const (
	// Hints are asked while the person waits for the extraction anyway.
	receiptBudget = 3 * time.Second
	// The correction check runs before a model call, so it is short; on
	// timeout the model call runs as before.
	correctionBudget = 1500 * time.Millisecond
	maxCategories    = 40
	maxNearReceipts  = 5
	maxReceiptTabs   = 30
	maxMatchFields   = 12
)

var expenseWord = regexp.MustCompile(`(?i)\bexpenses?\b`)

// receiptTab is a tab a receipt could be recorded in.
type receiptTab struct {
	sheetID, sheetTitle, workspaceID string
	tabID, tabName                   string
	merchants, categories            []string
	currencies                       []string
	first, last                      string // earliest and latest dates recorded
}

// receiptBook is what the person's sheets say about receipts: their
// categories (most used first), the tabs receipts go to, and recorded
// receipts close to this one.
type receiptBook struct {
	categories []string
	tabs       []receiptTab
	near       []sheet.RowMatch
}

func isExpenseTab(sh models.Sheet, tab models.SheetTab) bool {
	if normal(tab.Name) == "items" {
		return false
	}
	if columnID(tab.Columns, "Merchant") != "" && columnID(tab.Columns, "Total") != "" {
		return true
	}
	return expenseWord.MatchString(tab.Name) || expenseWord.MatchString(sh.Title)
}

// readBook reads the person's sheets once. A failed lookup reads as empty.
func (s *Service) readBook(ctx context.Context, uid string, r ReceiptDraft) receiptBook {
	var book receiptBook
	if s.rows == nil {
		return book
	}
	counts := map[string]int{}
	spelled := map[string]string{}
	target, totalOK := decimal(r.Total)
	day, dateErr := time.Parse("2006-01-02", r.Date)
	found, err := s.rows(s.db.WithContext(ctx)).FindRows(uid, func(sh models.Sheet, tab models.SheetTab) []models.SheetRow {
		items := normal(tab.Name) == "items"
		if !items && !isExpenseTab(sh, tab) {
			return nil
		}
		category := columnID(tab.Columns, "Category")
		merchant := columnID(tab.Columns, "Merchant")
		currencyCol, dateCol := columnID(tab.Columns, "Currency"), columnID(tab.Columns, "Date")
		seen := map[string]bool{}
		entry := receiptTab{sheetID: sh.ID, sheetTitle: sh.Title, workspaceID: sh.WorkspaceID, tabID: tab.ID, tabName: tab.Name}
		for i := len(tab.Rows) - 1; i >= 0; i-- {
			row := tab.Rows[i]
			if category != "" {
				if v := strings.TrimSpace(row.Cells[category]); v != "" && !strings.HasPrefix(v, "=") && len(v) <= 60 {
					counts[normal(v)]++
					if _, ok := spelled[normal(v)]; !ok {
						spelled[normal(v)] = v
					}
					if !items && len(entry.categories) < 5 && !seen["c"+normal(v)] {
						seen["c"+normal(v)] = true
						entry.categories = append(entry.categories, v)
					}
				}
			}
			if !items && currencyCol != "" {
				if v := strings.ToUpper(strings.TrimSpace(row.Cells[currencyCol])); currencyPattern.MatchString(v) && !seen["$"+v] && len(entry.currencies) < 3 {
					seen["$"+v] = true
					entry.currencies = append(entry.currencies, v)
				}
			}
			if !items && dateCol != "" {
				if v := row.Cells[dateCol]; len(v) == 10 {
					if _, err := time.Parse("2006-01-02", v); err == nil {
						if entry.first == "" || v < entry.first {
							entry.first = v
						}
						if v > entry.last {
							entry.last = v
						}
					}
				}
			}
			if !items && merchant != "" && len(entry.merchants) < 5 {
				if v := strings.TrimSpace(row.Cells[merchant]); v != "" && !strings.HasPrefix(v, "=") && !seen["m"+normal(v)] {
					seen["m"+normal(v)] = true
					entry.merchants = append(entry.merchants, clip(v, 60))
				}
			}
		}
		if items {
			return nil
		}
		if len(book.tabs) < maxReceiptTabs {
			book.tabs = append(book.tabs, entry)
		}
		// Recorded receipts with the same total and currency a few days apart,
		// or on the same day under another merchant name: the exact match is
		// findReceiptDuplicates' job.
		date, currency, total := columnID(tab.Columns, "Date"), columnID(tab.Columns, "Currency"), columnID(tab.Columns, "Total")
		if !totalOK || dateErr != nil || merchant == "" || date == "" || currency == "" || total == "" {
			return nil
		}
		var near []models.SheetRow
		for _, row := range tab.Rows {
			value, ok := decimal(row.Cells[total])
			if !ok || value.Cmp(target) != 0 || !strings.EqualFold(row.Cells[currency], r.Currency) {
				continue
			}
			when, err := time.Parse("2006-01-02", row.Cells[date])
			if err != nil || absDays(when.Sub(day)) > 3 {
				continue
			}
			if row.Cells[date] == r.Date && normal(row.Cells[merchant]) == normal(r.Merchant) {
				continue
			}
			near = append(near, row)
		}
		return near
	})
	if err != nil {
		return receiptBook{}
	}
	if len(found) > maxNearReceipts {
		found = found[:maxNearReceipts]
	}
	book.near = found
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.SliceStable(keys, func(i, j int) bool {
		if counts[keys[i]] != counts[keys[j]] {
			return counts[keys[i]] > counts[keys[j]]
		}
		return keys[i] < keys[j]
	})
	for _, k := range keys {
		if len(book.categories) == maxCategories {
			break
		}
		book.categories = append(book.categories, spelled[k])
	}
	return book
}

func absDays(d time.Duration) int {
	days := int(d.Hours() / 24)
	if days < 0 {
		return -days
	}
	return days
}

// dayWords says how far a recorded receipt's date is from this one, in words.
func dayWords(recorded, this string) string {
	a, errA := time.Parse("2006-01-02", recorded)
	b, errB := time.Parse("2006-01-02", this)
	if errA != nil || errB != nil {
		return "a nearby day"
	}
	switch n := int(a.Sub(b).Hours() / 24); {
	case n == 0:
		return "the same day"
	case n == 1:
		return "1 day later"
	case n == -1:
		return "1 day earlier"
	case n > 0:
		return fmt.Sprintf("%d days later", n)
	default:
		return fmt.Sprintf("%d days earlier", -n)
	}
}

// monthWords turns a YYYY-MM-DD date into "September 2026"; Jev reads
// words, not dates.
func monthWords(date string) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return ""
	}
	return t.Format("January 2006")
}

// receiptFacts is the receipt as Jev sees it: names only, no amounts.
func receiptFacts(r ReceiptDraft) map[string]any {
	items := []string{}
	for _, item := range r.Items {
		if len(items) == 20 {
			break
		}
		if d := clip(item.Description, 80); d != "" {
			items = append(items, d)
		}
	}
	facts := map[string]any{"merchant": clip(r.Merchant, 100), "items": items}
	if currencyPattern.MatchString(r.Currency) {
		facts["currency"] = r.Currency
	}
	if month := monthWords(r.Date); month != "" {
		facts["month"] = month
	}
	if len(r.Items) > len(items) {
		facts["moreItems"] = len(r.Items) - len(items)
	}
	return facts
}

// receiptHints asks Jev about a receipt draft: which of the person's
// categories fits it (only when prefill is set: a correction the person typed
// keeps their category), whether its category fits, whether it is a refund,
// whether a recorded receipt is the same purchase, and which expense tab it
// belongs in. It may change r.Category and its items' categories, and returns
// the review hints and a suggested destination.
func (s *Service) receiptHints(ctx context.Context, c *Conversation, r *ReceiptDraft, prefill bool) ([]string, *ReceiptDestination) {
	if r == nil || !s.jevOn(ctx, c.UserID) {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, receiptBudget)
	defer cancel()
	book := s.readBook(ctx, c.UserID, *r)
	facts := receiptFacts(*r)
	state := map[string]any{"receipt": facts}
	questions := map[string]decide.Question{
		"refund": decide.YesNo("Is this receipt a refund, return or credit rather than a purchase?",
			"A refund, return or credit note.", "An ordinary purchase."),
	}
	known := ""
	for _, category := range book.categories {
		if normal(category) == normal(r.Category) {
			known = category
		}
	}
	switch {
	case known != "":
		facts["category"] = known
		questions["fits"] = decide.YesNo("Does the category given for this receipt fit what was bought?",
			"The category fits this purchase.", "The category does not fit this purchase.")
	case prefill && len(book.categories) > 0:
		options := make([]decide.Option, 0, len(book.categories)+1)
		for _, category := range book.categories {
			options = append(options, decide.Option{Name: category})
		}
		options = append(options, decide.Option{Name: "none", Description: "None of these categories fits this purchase"})
		state["categories"] = book.categories
		questions["category"] = decide.Choice("Which of the person's own expense categories fits this purchase best?", options...)
	}
	recorded := make([]map[string]string, len(book.near))
	for i, m := range book.near {
		recorded[i] = map[string]string{
			"number":   fmt.Sprint(i + 1),
			"merchant": clip(m.Row.Cells[columnID(m.Tab.Columns, "Merchant")], 100),
			"when":     dayWords(m.Row.Cells[columnID(m.Tab.Columns, "Date")], r.Date),
			"total":    "exactly the same total in the same currency",
		}
		if category := columnID(m.Tab.Columns, "Category"); category != "" && m.Row.Cells[category] != "" {
			recorded[i]["category"] = clip(m.Row.Cells[category], 60)
		}
		questions[fmt.Sprintf("same%d", i+1)] = decide.YesNo(fmt.Sprintf("Is this receipt probably a purchase that is already recorded as entry number %d? Card statements and receipts often name the same shop differently (a chain name, a store number) and can differ by a day.", i+1),
			"Probably the same purchase, already recorded.", "Probably a different purchase, at a different shop or a different time.")
	}
	if len(recorded) > 0 {
		state["recorded"] = recorded
	}
	if len(book.tabs) > 0 {
		options := make([]decide.Option, 0, len(book.tabs)+1)
		for i, tab := range book.tabs {
			text := fmt.Sprintf("Sheet “%s”, tab “%s”", clip(tab.sheetTitle, 80), clip(tab.tabName, 60))
			if len(tab.merchants) > 0 {
				text += "; recent shops: " + strings.Join(tab.merchants, ", ")
			}
			if len(tab.categories) > 0 {
				text += "; categories: " + strings.Join(tab.categories, ", ")
			}
			if len(tab.currencies) > 0 {
				text += "; currencies: " + strings.Join(tab.currencies, ", ")
			}
			if from, to := monthWords(tab.first), monthWords(tab.last); from != "" {
				if from == to {
					text += "; entries from " + from
				} else {
					text += "; entries from " + from + " to " + to
				}
			}
			options = append(options, decide.Option{Name: fmt.Sprintf("t%d", i+1), Description: text})
		}
		options = append(options, decide.Option{Name: "new", Description: "A separate new sheet: this receipt belongs to none of these (for example a different trip, project or currency)"})
		questions["destination"] = decide.Choice("Where should this receipt be recorded? An everyday purchase goes in the person's general spending sheet; a purchase made during a trip or for a project goes in that trip's or project's sheet, matching currency and dates.", options...)
	}
	a, err := s.decisions.Ask(ctx, c.UserID, decide.Request{Feature: "receipt", State: state, Questions: questions, Private: true})
	if err != nil {
		return nil, nil
	}
	hints := []string{}
	if choice, ok := a.Choice("category", decide.Prefill); ok && choice != "none" {
		before := normal(r.Category)
		for i := range r.Items {
			if item := normal(r.Items[i].Category); item == "" || item == before {
				r.Items[i].Category = choice
			}
		}
		r.Category = choice
		hints = append(hints, fmt.Sprintf(tr(c.Language, txtHintCategory), choice))
	} else if known != "" {
		// The person's own spelling, on the receipt and its items.
		for i := range r.Items {
			if normal(r.Items[i].Category) == normal(known) {
				r.Items[i].Category = known
			}
		}
		r.Category = known
	}
	if yes, ok := a.Yes("fits", decide.Flag); ok && !yes {
		hints = append(hints, fmt.Sprintf(tr(c.Language, txtHintCategoryFit), known))
	}
	if yes, ok := a.Yes("refund", decide.Flag); ok && yes {
		hints = append(hints, tr(c.Language, txtHintRefund))
	}
	for i, m := range book.near {
		if yes, ok := a.Yes(fmt.Sprintf("same%d", i+1), decide.Flag); ok && yes {
			cells := m.Row.Cells
			hints = append(hints, fmt.Sprintf(tr(c.Language, txtHintSamePurchase),
				clip(cells[columnID(m.Tab.Columns, "Merchant")], 100), cells[columnID(m.Tab.Columns, "Date")], clip(m.Sheet.Title, 80)))
		}
	}
	hints = append(hints, includedHints(c.Language, *r)...)
	var suggested *ReceiptDestination
	if choice, ok := a.Choice("destination", decide.Prefill); ok && strings.HasPrefix(choice, "t") {
		var n int
		if _, err := fmt.Sscanf(choice, "t%d", &n); err == nil && n >= 1 && n <= len(book.tabs) {
			tab := book.tabs[n-1]
			suggested = &ReceiptDestination{SheetID: tab.sheetID, WorkspaceID: tab.workspaceID, Title: tab.sheetTitle, ExpenseTabID: tab.tabID}
		}
	}
	return hints, suggested
}

// includedHints spots a reconciliation that works once tax or the discount
// is counted as already included in the prices. It is arithmetic, so code
// does it, but it is shown with the other hints only when Jev answered.
func includedHints(language string, r ReceiptDraft) []string {
	if len(reconciliationIssues(r)) == 0 {
		return nil
	}
	hints := []string{}
	if r.Tax != "" && !r.TaxIncluded {
		trial := r
		trial.TaxIncluded = true
		if len(reconciliationIssues(trial)) == 0 {
			hints = append(hints, tr(language, txtHintTaxIncluded))
		}
	}
	if r.Discount != "" && !r.DiscountIncluded {
		trial := r
		trial.DiscountIncluded = true
		if len(reconciliationIssues(trial)) == 0 {
			hints = append(hints, tr(language, txtHintDiscountIncluded))
		}
	}
	return hints
}

// receiptCorrection asks whether the person's latest message changes the
// receipt draft. sure is false when Jev is off or unsure; the model then
// reads the message as before.
func (s *Service) receiptCorrection(ctx context.Context, c *Conversation) (correction, sure bool) {
	if s.decisions == nil || c.ImageReview == nil || c.ImageReview.Receipt == nil {
		return false, false
	}
	ctx, cancel := context.WithTimeout(ctx, correctionBudget)
	defer cancel()
	latest, _ := latestRequest(c)
	if latest == "" {
		return false, false
	}
	state := map[string]any{"message": clip(latest, 1000), "receipt": receiptFacts(*c.ImageReview.Receipt)}
	a, err := s.decisions.Ask(ctx, c.UserID, decide.Request{Feature: "receipt_edit", State: state, Private: true, Questions: map[string]decide.Question{
		"change": decide.YesNo("The person is checking a receipt that was read from a photo, before it is saved. Does their latest message correct or change the receipt in any way, including by just stating a value (\"the total is 12.40\", \"it was in euros\", \"wrong date, it was the 7th\") or asking to add, remove or edit an item, the shop, date, currency, an amount, tax, discount or category?",
			"It corrects or changes something in the receipt, or states a value for it.", "It only thanks, approves, asks a question, or asks for something other than a change to the receipt's details."),
	}})
	if err != nil {
		return false, false
	}
	return a.Yes("change", decide.Route)
}

// receiptFields are the columns a receipt fills, per kind of tab.
var (
	summaryColumns = []string{"Receipt ID", "Merchant", "Date", "Currency", "Category", "Subtotal", "Tax", "Tip", "Discount", "Total", "Tax included", "Discount included"}
	itemColumns    = []string{"Receipt ID", "Merchant", "Date", "Currency", "Description", "Quantity", "Unit price", "Amount", "Category"}
)

func columnKey(tabID, field string) string { return tabID + "/" + field }

// receiptColumnMatches asks, for each field the destination's tabs have no
// column for by name, which of the tab's other columns holds it ("Shop" for
// Merchant). Answers are kept only when Jev agrees in both option orders.
// buildReceiptProposal still refuses a column of the wrong type.
func (s *Service) receiptColumnMatches(ctx context.Context, uid string, d *ReceiptDestination) map[string]string {
	if d == nil || d.SheetID == "" || !s.jevOn(ctx, uid) {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, receiptBudget)
	defer cancel()
	result, err := s.factory(s.db.WithContext(ctx))["get_sheet"].Call(ctx, uid, raw(map[string]string{"sheetId": d.SheetID}))
	if err != nil {
		return nil
	}
	var payload struct {
		Sheet models.Sheet `json:"sheet"`
	}
	if json.Unmarshal(raw(result), &payload) != nil || payload.Sheet.ID == "" {
		return nil
	}
	tabs := sheet.TabsOf(payload.Sheet)
	expense := -1
	for i := range tabs {
		if (d.ExpenseTabID != "" && tabs[i].ID == d.ExpenseTabID) || (d.ExpenseTabID == "" && expense < 0 && normal(tabs[i].Name) == "expenses") {
			expense = i
		}
	}
	if expense < 0 && d.ExpenseTabID == "" && len(tabs) > 0 {
		expense = 0
	}
	type ask struct{ tab, field string }
	var asks []ask
	state := map[string]any{}
	questions := map[string]decide.Question{}
	options := map[string][]string{} // tab id -> column id by option number
	for i, tab := range tabs {
		fields := itemColumns
		if normal(tab.Name) != "items" {
			if i != expense {
				continue
			}
			fields = summaryColumns
		}
		matched := map[string]bool{}
		missing := []string{}
		for _, field := range fields {
			if id := columnID(tab.Columns, field); id != "" {
				matched[id] = true
			} else {
				missing = append(missing, field)
			}
		}
		free := []models.SheetColumn{}
		for _, col := range tab.Columns {
			if !matched[col.ID] && strings.TrimSpace(col.Name) != "" {
				free = append(free, col)
			}
		}
		if len(missing) == 0 || len(free) == 0 {
			continue
		}
		columns := []map[string]any{}
		opts := []decide.Option{}
		for j, col := range free {
			samples := []string{}
			for k := len(tab.Rows) - 1; k >= 0 && len(samples) < 3; k-- {
				if v := strings.TrimSpace(tab.Rows[k].Cells[col.ID]); v != "" && !strings.HasPrefix(v, "=") {
					samples = append(samples, clip(v, 40))
				}
			}
			name := fmt.Sprintf("k%d", j+1)
			columns = append(columns, map[string]any{"column": name, "name": clip(col.Name, 60), "type": col.Type, "examples": samples})
			opts = append(opts, decide.Option{Name: name, Description: fmt.Sprintf("The column “%s”", clip(col.Name, 60))})
			options[tab.ID] = append(options[tab.ID], col.ID)
		}
		opts = append(opts, decide.Option{Name: "none", Description: "No existing column holds it; a new column is added"})
		state[fmt.Sprintf("tab%d", i+1)] = map[string]any{"name": clip(tab.Name, 60), "unmatchedColumns": columns}
		for _, field := range missing {
			if len(asks) == maxMatchFields {
				break
			}
			key := fmt.Sprintf("m%d", len(asks)+1)
			asks = append(asks, ask{tab.ID, field})
			questions[key] = decide.Choice(fmt.Sprintf("A receipt is being recorded in the sheet tab “%s” (tab%d). Which of its unmatched columns already holds the receipt's “%s”?", clip(tab.Name, 60), i+1, field), opts...).Twice()
		}
	}
	if len(questions) == 0 {
		return nil
	}
	state["sheet"] = clip(payload.Sheet.Title, 80)
	a, err := s.decisions.Ask(ctx, uid, decide.Request{Feature: "receipt_columns", State: state, Questions: questions, Private: true})
	if err != nil {
		return nil
	}
	matches := map[string]string{}
	used := map[string]bool{}
	for i, x := range asks {
		choice, ok := a.Choice(fmt.Sprintf("m%d", i+1), decide.Route)
		if !ok || choice == "none" {
			continue
		}
		var n int
		if _, err := fmt.Sscanf(choice, "k%d", &n); err != nil || n < 1 || n > len(options[x.tab]) {
			continue
		}
		col := options[x.tab][n-1]
		if used[x.tab+"/"+col] {
			continue // two fields never share a column
		}
		used[x.tab+"/"+col] = true
		matches[columnKey(x.tab, x.field)] = col
	}
	if len(matches) == 0 {
		return nil
	}
	return matches
}

// sheetChange describes an update_sheet step against the sheet as it is now,
// in words: columns added, removed, renamed or retyped, and rows added,
// removed or edited, per tab. Empty when nothing can be compared.
func sheetChange(before models.Sheet, args json.RawMessage) string {
	var in struct {
		Columns *models.SheetColumns `json:"columns"`
		Rows    *models.SheetRows    `json:"rows"`
		Tabs    *models.SheetTabs    `json:"tabs"`
	}
	if json.Unmarshal(args, &in) != nil {
		return ""
	}
	parts := []string{}
	if in.Tabs != nil {
		old := map[string]models.SheetTab{}
		for _, tab := range sheet.TabsOf(before) {
			old[tab.ID] = tab
		}
		kept := map[string]bool{}
		for _, tab := range *in.Tabs {
			prev, ok := old[tab.ID]
			if !ok && len(old) == 1 && len(*in.Tabs) == 1 {
				for _, only := range old {
					prev, ok = only, true
				}
			}
			if !ok {
				parts = append(parts, fmt.Sprintf("adds the tab “%s” with %d columns and %d rows", clip(tab.Name, 60), len(tab.Columns), len(tab.Rows)))
				continue
			}
			kept[prev.ID] = true
			if text := gridChange(prev.Columns, prev.Rows, tab.Columns, tab.Rows); text != "" {
				parts = append(parts, fmt.Sprintf("tab “%s”: %s", clip(tab.Name, 60), text))
			}
		}
		for _, tab := range sheet.TabsOf(before) {
			if !kept[tab.ID] {
				parts = append(parts, fmt.Sprintf("removes the tab “%s” and its %d rows", clip(tab.Name, 60), len(tab.Rows)))
			}
		}
	} else if in.Columns != nil || in.Rows != nil {
		columns, rows := before.Columns, before.Rows
		if in.Columns != nil {
			columns = *in.Columns
		}
		if in.Rows != nil {
			rows = *in.Rows
		}
		if text := gridChange(before.Columns, before.Rows, columns, rows); text != "" {
			parts = append(parts, text)
		}
	}
	return clip(strings.Join(parts, "; "), 400)
}

func gridChange(oldCols models.SheetColumns, oldRows models.SheetRows, newCols models.SheetColumns, newRows models.SheetRows) string {
	parts := []string{}
	prevCol := map[string]models.SheetColumn{}
	for _, col := range oldCols {
		prevCol[col.ID] = col
	}
	added, renamed, retyped := []string{}, []string{}, []string{}
	kept := map[string]bool{}
	for _, col := range newCols {
		prev, ok := prevCol[col.ID]
		if !ok {
			added = append(added, "“"+clip(col.Name, 40)+"”")
			continue
		}
		kept[col.ID] = true
		if strings.TrimSpace(prev.Name) != strings.TrimSpace(col.Name) {
			renamed = append(renamed, fmt.Sprintf("“%s” to “%s”", clip(prev.Name, 40), clip(col.Name, 40)))
		}
		if prev.Type != col.Type && prev.Type != "" && col.Type != "" {
			retyped = append(retyped, fmt.Sprintf("“%s” from %s to %s", clip(col.Name, 40), prev.Type, col.Type))
		}
	}
	removed := []string{}
	for _, col := range oldCols {
		if !kept[col.ID] {
			removed = append(removed, "“"+clip(col.Name, 40)+"”")
		}
	}
	for _, x := range []struct {
		label string
		list  []string
	}{{"adds columns", added}, {"removes columns", removed}, {"renames", renamed}, {"changes the type of", retyped}} {
		if len(x.list) > 0 {
			parts = append(parts, x.label+" "+strings.Join(x.list, ", "))
		}
	}
	prevRow := map[string]models.SheetRow{}
	for _, row := range oldRows {
		prevRow[row.ID] = row
	}
	nextRow := map[string]bool{}
	addedRows, editedRows := 0, 0
	for _, row := range newRows {
		nextRow[row.ID] = true
		prev, ok := prevRow[row.ID]
		if !ok {
			if !emptyRow(row) {
				addedRows++
			}
			continue
		}
		if !sameCells(prev.Cells, row.Cells) {
			editedRows++
		}
	}
	removedRows := 0
	for _, row := range oldRows {
		if !nextRow[row.ID] && !emptyRow(row) {
			removedRows++
		}
	}
	for _, x := range []struct {
		n    int
		verb string
	}{{addedRows, "adds"}, {removedRows, "removes"}, {editedRows, "edits"}} {
		if x.n == 1 {
			parts = append(parts, x.verb+" 1 row")
		} else if x.n > 1 {
			parts = append(parts, fmt.Sprintf("%s %d rows", x.verb, x.n))
		}
	}
	return strings.Join(parts, ", ")
}

func emptyRow(row models.SheetRow) bool {
	for _, v := range row.Cells {
		if strings.TrimSpace(v) != "" {
			return false
		}
	}
	return true
}

func sameCells(a, b map[string]string) bool {
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	for k, v := range b {
		if a[k] != v {
			return false
		}
	}
	return true
}

// sheetChanges describes each update_sheet step of a proposal, keyed by step
// index, against the sheet as it is now.
func (s *Service) sheetChanges(ctx context.Context, uid string, steps []Step) map[int]string {
	out := map[int]string{}
	if s.factory == nil {
		return out
	}
	get := s.factory(s.db.WithContext(ctx))["get_sheet"]
	if get.Call == nil {
		return out
	}
	for i, step := range steps {
		if step.Tool != "update_sheet" {
			continue
		}
		var in struct {
			SheetID string `json:"sheetId"`
		}
		if json.Unmarshal(step.Arguments, &in) != nil || in.SheetID == "" || strings.HasPrefix(in.SheetID, "$") {
			continue
		}
		result, err := get.Call(ctx, uid, raw(map[string]string{"sheetId": in.SheetID}))
		if err != nil {
			continue
		}
		var payload struct {
			Sheet models.Sheet `json:"sheet"`
		}
		if json.Unmarshal(raw(result), &payload) != nil || payload.Sheet.ID == "" {
			continue
		}
		if text := sheetChange(payload.Sheet, step.Arguments); text != "" {
			out[i] = text
		}
	}
	return out
}
