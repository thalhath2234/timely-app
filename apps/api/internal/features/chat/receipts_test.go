package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/agent"
	"timely-api/internal/models"
)

func receiptFixture() ReceiptDraft {
	return ReceiptDraft{Merchant: "Corner Shop", Date: "2026-09-29", Currency: "JPY", Subtotal: "300", Tax: "30", Total: "330", Items: []ReceiptItem{{Description: "Rice", Quantity: "1", UnitPrice: "100", Amount: "100"}, {Description: "Tea", Quantity: "2", UnitPrice: "100", Amount: "200"}}, Issues: []string{}}
}
func TestReceiptReconciliation(t *testing.T) {
	r := receiptFixture()
	if issues := receiptIssues(r); len(issues) > 0 {
		t.Fatal(issues)
	}
	r.Items[1].Amount = "190"
	if len(receiptIssues(r)) == 0 {
		t.Fatal("mismatched item sum accepted")
	}
	r = receiptFixture()
	r.TaxIncluded = true
	r.Total = "300"
	if issues := receiptIssues(r); len(issues) > 0 {
		t.Fatal(issues)
	}
	r = receiptFixture()
	r.Total = "unknown"
	if len(receiptIssues(r)) == 0 {
		t.Fatal("unknown total accepted")
	}
	r = receiptFixture()
	r.Currency = "¥"
	if len(receiptIssues(r)) == 0 {
		t.Fatal("ambiguous currency accepted")
	}
	r = receiptFixture()
	r.Subtotal = ""
	r.Tax = ""
	r.Total = "0.30"
	r.Items = []ReceiptItem{{Description: "A", Amount: "0.10"}, {Description: "B", Amount: "0.20"}}
	if issues := receiptIssues(r); len(issues) > 0 {
		t.Fatal("decimal rounding", issues)
	}
}
func TestReceiptDiscountAlreadyIncluded(t *testing.T) {
	r := receiptFixture()
	r.Subtotal, r.Tax, r.Discount, r.Total = "228", "18", "60", "246"
	r.Items = []ReceiptItem{{Description: "Salmon roll", UnitPrice: "200", Amount: "140"}, {Description: "Water", Amount: "88"}}
	r.DiscountIncluded = true
	if issues := receiptIssues(r); len(issues) != 0 {
		t.Fatal(issues)
	}
	r.DiscountIncluded = false
	if len(receiptIssues(r)) == 0 {
		t.Fatal("unaccounted discount accepted")
	}
	r.Total = "186"
	if issues := receiptIssues(r); len(issues) != 0 {
		t.Fatal("additional discount rejected", issues)
	}

}

func fakeSheetCatalog(tx *gorm.DB) agent.Catalog {
	catalog := agent.NewCatalog(agent.Deps{})
	get := catalog["get_sheet"]
	get.Call = func(ctx context.Context, uid string, args json.RawMessage) (any, error) {
		var input struct {
			SheetID string `json:"sheetId"`
		}
		_ = json.Unmarshal(args, &input)
		var sheet models.Sheet
		err := tx.Where("id = ? AND user_id = ?", input.SheetID, uid).First(&sheet).Error
		return map[string]any{"sheet": sheet}, err
	}
	catalog["get_sheet"] = get
	update := catalog["update_sheet"]
	update.Call = func(ctx context.Context, uid string, args json.RawMessage) (any, error) {
		var input struct {
			SheetID string           `json:"sheetId"`
			Tabs    models.SheetTabs `json:"tabs"`
		}
		_ = json.Unmarshal(args, &input)
		err := tx.Model(&models.Sheet{}).Where("id = ? AND user_id = ?", input.SheetID, uid).Update("tabs", input.Tabs).Error
		return map[string]any{"sheet": map[string]any{"id": input.SheetID}}, err
	}
	catalog["update_sheet"] = update
	return catalog
}
func TestIntegrationReceiptProposalPreservesGridAndChecksDuplicates(t *testing.T) {
	db := integrationDB(t)
	s := New(db, fakeSheetCatalog, nil)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	sheet := models.Sheet{WorkspaceID: "workspace", ID: "sheet", Title: "Expenses", UserID: "user-a", Tabs: models.SheetTabs{{ID: "expenses", Name: "Expenses", Columns: models.SheetColumns{{ID: "formula", Name: "Custom", Type: "formula", Width: 120}}, Rows: models.SheetRows{{ID: "keep", Cells: map[string]string{"formula": "=1+2"}}}}, {ID: "notes", Name: "Notes", Columns: models.SheetColumns{{ID: "note", Name: "Notes", Type: "text", Width: 120}}, Rows: models.SheetRows{{ID: "note1", Cells: map[string]string{"note": "Keep this"}}}}}}
	if err := db.Create(&sheet).Error; err != nil {
		t.Fatal(err)
	}
	c := runFixture(t, db, nil)
	r := receiptFixture()
	c.ImageReview = &ImageReview{Status: "review", ReceiptID: "receipt-one", Receipt: &r, Destination: &ReceiptDestination{SheetID: sheet.ID}}
	if err := s.buildReceiptProposal(context.Background(), db, &c); err != nil {
		t.Fatal(err)
	}
	if c.Status != "approval" || len(c.Plan) != 1 {
		t.Fatal("receipt must require approval")
	}
	var input struct {
		Tabs models.SheetTabs `json:"tabs"`
	}
	if err := json.Unmarshal(c.Plan[0].Arguments, &input); err != nil {
		t.Fatal(err)
	}
	if len(input.Tabs) != 3 || input.Tabs[0].Rows[0].Cells["formula"] != "=1+2" || input.Tabs[1].Rows[0].Cells["note"] != "Keep this" {
		t.Fatal("unrelated content changed")
	}
	if len(input.Tabs[2].Rows) != 2 {
		t.Fatal("missing individual items")
	}
	c.Status = "running"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	matches := findReceiptDuplicates(db, "user-a", r)
	if len(matches) != 1 {
		t.Fatal("duplicate not detected", matches)
	}
	if len(findReceiptDuplicates(db, "user-b", r)) != 0 {
		t.Fatal("cross-account duplicate exposed")
	}
	next := runFixture(t, db, nil)
	next.ImageReview = &ImageReview{ReceiptID: "receipt-two", Receipt: &r, Destination: &ReceiptDestination{SheetID: sheet.ID}}
	if err := s.buildReceiptProposal(context.Background(), db, &next); err != nil {
		t.Fatal(err)
	}
	if next.Status != "idle" || len(next.Plan) != 0 || len(next.ImageReview.Duplicates) != 1 {
		t.Fatal("duplicate silently written")
	}
	next.ImageReview.Destination.DuplicateAction = "update"
	next.ImageReview.Destination.DuplicateRowID = matches[0].RowID
	if err := s.buildReceiptProposal(context.Background(), db, &next); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(next.Plan[0].Arguments, &input); err != nil {
		t.Fatal(err)
	}
	if len(input.Tabs[0].Rows) != 2 || len(input.Tabs[2].Rows) != 2 {
		t.Fatal("update duplicated receipt/items")
	}
}
func imageRoutes(s *Service, uid string) *echo.Echo {
	e := echo.New()
	g := e.Group("")
	g.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error { c.Set("userID", uid); return next(c) }
	})
	s.Routes(g)
	return e
}
func TestIntegrationImageOwnershipConfirmationAndExpiry(t *testing.T) {
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	db := integrationDB(t)
	s := New(db, nil, nil)
	e := imageRoutes(s, "user-a")
	var data bytes.Buffer
	w := multipart.NewWriter(&data)
	part, err := w.CreateFormFile("image", "receipt.png")
	if err != nil {
		t.Fatal(err)
	}
	picture := image.NewRGBA(image.Rect(0, 0, 8, 8))
	picture.Set(1, 1, color.White)
	if err := png.Encode(part, picture); err != nil {
		t.Fatal(err)
	}
	_ = w.Close()
	req := httptest.NewRequest("POST", "/chats/images", &data)
	req.Header.Set("Content-Type", w.FormDataContentType())
	response := httptest.NewRecorder()
	e.ServeHTTP(response, req)
	if response.Code != 201 {
		t.Fatalf("upload: %d %s", response.Code, response.Body.String())
	}
	var image ImageAttachment
	if err := json.Unmarshal(response.Body.Bytes(), &image); err != nil {
		t.Fatal(err)
	}
	other := imageRoutes(s, "user-b")
	response = httptest.NewRecorder()
	other.ServeHTTP(response, httptest.NewRequest("GET", "/chats/images/"+image.ID, nil))
	if response.Code != 404 {
		t.Fatal("cross-account image read")
	}
	c := runFixture(t, db, nil)
	c.Messages = []Message{message("user", "Read image")}
	wrong := Conversation{ID: c.ID, UserID: "user-b", Messages: []Message{message("user", "Read")}}
	if err := attachImages(db, &wrong, []string{image.ID}); err == nil {
		t.Fatal("cross-account image attachment")
	}

	if err := attachImages(db, &c, []string{image.ID}); err != nil {
		t.Fatal(err)
	}
	c.Status = "approval"
	c.Phase = "apply"
	c.ImageReview.Status = "review"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	e.ServeHTTP(response, httptest.NewRequest("GET", "/chats/images/"+image.ID, nil))
	if response.Code != 200 || !strings.Contains(response.Header().Get("Cache-Control"), "no-store") {
		t.Fatal("missing private image access")
	}
	req = httptest.NewRequest("POST", "/chats/"+c.ID+"/approve", strings.NewReader(`{"revision":99}`))
	req.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	e.ServeHTTP(response, req)
	if response.Code != 409 {
		t.Fatal("stale image approval accepted")
	}
	if _, err := os.Stat(imagePath(image.ID)); err != nil {
		t.Fatal("image deleted before valid confirmation")
	}
	req = httptest.NewRequest("POST", "/chats/"+c.ID+"/approve", strings.NewReader(`{"revision":0}`))
	req.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	e.ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	if _, err := os.Stat(imagePath(image.ID)); !os.IsNotExist(err) {
		t.Fatal("confirmed image retained")
	}
	response = httptest.NewRecorder()
	e.ServeHTTP(response, httptest.NewRequest("GET", "/chats/images/"+image.ID, nil))
	if response.Code != 410 {
		t.Fatal("deleted image still accessible")
	}
	expired := ImageAttachment{ID: "expired", UserID: "user-a", Name: "Expired", ExpiresAt: time.Now().Add(-time.Second), CreatedAt: time.Now().Add(-25 * time.Hour)}
	if err := db.Create(&expired).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath(expired.ID), []byte("expired"), 0600); err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	e.ServeHTTP(response, httptest.NewRequest("GET", "/chats/images/expired", nil))
	if response.Code != 410 {
		t.Fatal("expired image accessible")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.cleanImages(ctx); close(done) }()
	deadline := time.Now().Add(time.Second)
	for {
		if _, err := os.Stat(imagePath(expired.ID)); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("expired image not erased")
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	<-done
}

type receiptCompleter struct{ t *testing.T }

func (p receiptCompleter) Complete(ctx context.Context, m []WireMessage, tools []any, search bool) (WireMessage, error) {
	if search || len(tools) > 0 || !m[0].Sensitive || len(m[1].ImageURLs) != 1 {
		p.t.Fatal("unsafe extraction request")
	}
	if !strings.HasPrefix(m[1].ImageURLs[0], "data:image/jpeg;base64,") {
		p.t.Fatal("missing image")
	}
	return WireMessage{Role: "assistant", Content: string(raw(map[string]any{"text": "Corner Shop receipt", "receipt": receiptFixture()}))}, nil
}
func TestIntegrationExtractionAndStaleReceiptRefresh(t *testing.T) {
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	db := integrationDB(t)
	s := New(db, fakeSheetCatalog, receiptCompleter{t})
	c := runFixture(t, db, nil)
	c.Messages = []Message{message("user", "Read my receipt")}
	c.Phase = "extract"
	a := ImageAttachment{ID: "photo", UserID: c.UserID, ConversationID: &c.ID, Name: "Receipt", ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now()}
	if err := db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath(a.ID), []byte("synthetic bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	c.ImageReview = &ImageReview{ReceiptID: "r", ImageIDs: []string{a.ID}, Status: "extracting"}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.extractImages(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if c.Status != "idle" || len(c.Plan) > 0 || len(c.ImageReview.Receipt.Items) != 2 {
		t.Fatal("extraction wrote without review")
	}
	if _, err := os.Stat(imagePath(a.ID)); err != nil {
		t.Fatal("image removed before review")
	}
	serialized := string(raw(c))
	if strings.Contains(serialized, "base64") {
		t.Fatal("image bytes persisted")
	}
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	sheet := models.Sheet{ID: "s", Title: "Expenses", UserID: c.UserID, WorkspaceID: "workspace", Columns: models.SheetColumns{{ID: "notes", Name: "Notes", Type: "text", Width: 120}}, Rows: models.SheetRows{}}
	if err := db.Create(&sheet).Error; err != nil {
		t.Fatal(err)
	}
	c.ImageReview.Destination = &ReceiptDestination{SheetID: sheet.ID}
	if err := s.buildReceiptProposal(context.Background(), db, &c); err != nil {
		t.Fatal(err)
	}
	c.Status = "running"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&sheet).Update("rows", models.SheetRows{{ID: "concurrent", Cells: map[string]string{"notes": "Added after review"}}}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if c.Phase != "receipt_plan" || c.Status != "queued" {
		t.Fatal("stale receipt applied")
	}
	c.Status = "running"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.refreshReceipt(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if c.Status != "approval" || !strings.Contains(string(c.Plan[0].Arguments), "Added after review") {
		t.Fatal("refresh lost concurrent data or skipped approval")
	}
}

func TestReceiptWithoutItems(t *testing.T) {
	for _, subtotal := range []string{"300", ""} {
		r := receiptFixture()
		r.Items = nil
		r.Subtotal = subtotal
		if issues := receiptIssues(r); len(issues) != 0 {
			t.Fatal(issues)
		}
		items := receiptItems(r)
		if len(items) != 1 || items[0].Description != r.Merchant || items[0].Amount != "330" {
			t.Fatal(items)
		}
		if len(r.Items) != 0 {
			t.Fatal("fallback changed extracted draft")
		}
	}
	r := receiptFixture()
	r.Items = nil
	r.Merchant = "ストーンクラブ２号店"
	r.Subtotal, r.Total, r.Tax, r.TaxIncluded = "7570", "7570", "561", true
	if issues := receiptIssues(r); len(issues) != 0 {
		t.Fatal(issues)
	}
	r.Total = ""
	if len(receiptIssues(r)) == 0 {
		t.Fatal("missing total accepted")
	}
	r = receiptFixture()
	if len(receiptItems(r)) != 2 {
		t.Fatal("real items replaced")
	}
}

func TestIntegrationSummaryOnlyReceiptApply(t *testing.T) {
	db := integrationDB(t)
	s := New(db, fakeSheetCatalog, nil)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	sheet := models.Sheet{ID: "sheet", WorkspaceID: "workspace", Title: "Expense", UserID: "user-a"}
	columns := models.SheetColumns{{ID: "label", Name: "A", Type: "text"}, {ID: "amount", Name: "B", Type: "number"}}
	rows := models.DefaultSheetRows(columns, 20)
	for i, label := range []string{"Rent", "Electricity", "Gas", "Total"} {
		rows[i].Cells["label"] = label
	}
	rows[3].Cells["amount"] = "=SUM(B1:B3)"
	blankID := rows[4].ID
	rows[4].Formats = map[string]models.SheetCellFormat{"amount": {Bold: true}}
	sheet.Tabs = models.SheetTabs{{ID: "expenses", Name: "Expenses", Columns: columns, Rows: rows}, {ID: "items", Name: "Items", Rows: models.DefaultSheetRows(nil, 20)}}
	if err := db.Create(&sheet).Error; err != nil {
		t.Fatal(err)
	}
	c := runFixture(t, db, nil)
	r := receiptFixture()
	r.Items = nil
	c.ImageReview = &ImageReview{Status: "review", ReceiptID: "summary-receipt", Receipt: &r, Destination: &ReceiptDestination{SheetID: sheet.ID}}
	if err := s.buildReceiptProposal(context.Background(), db, &c); err != nil {
		t.Fatal(err)
	}
	if c.Status != "approval" {
		t.Fatal("missing approval")
	}
	c.Status = "running"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&sheet, "id = ?", sheet.ID).Error; err != nil {
		t.Fatal(err)
	}
	if len(sheet.Tabs) != 2 {
		t.Fatal(sheet.Tabs)
	}
	summary, items := sheet.Tabs[0], sheet.Tabs[1]
	if len(summary.Rows) != 20 || summary.Rows[4].Cells[columnID(summary.Columns, "Total")] != "330" {
		t.Fatalf("receipt should occupy row 5 of the existing 20 rows; got %d rows", len(summary.Rows))
	}
	if summary.Rows[4].ID != blankID || !summary.Rows[4].Formats["amount"].Bold || summary.Rows[3].Cells["amount"] != "=SUM(B1:B3)" {
		t.Fatal("existing row identity, format or formula changed")
	}
	if len(items.Rows) != 20 || items.Rows[0].Cells[columnID(items.Columns, "Description")] != r.Merchant || items.Rows[0].Cells[columnID(items.Columns, "Amount")] != "330" {
		t.Fatal(items)
	}
	matches := findReceiptDuplicates(db, "user-a", r)
	if len(matches) != 1 || matches[0].ItemMatch != "same" {
		t.Fatal(matches)
	}
}

func TestReceiptRowPlacementPreservesLayout(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(*models.SheetTab)
		want  int
	}{
		{"empty padding", func(tab *models.SheetTab) {}, 0},
		{"internal gap", func(tab *models.SheetTab) { tab.Rows[2].Cells["a"] = "keep" }, 3},
		{"formula", func(tab *models.SheetTab) { tab.Rows[2].Cells["a"] = "=SUM(A1:A2)" }, 3},
		{"note", func(tab *models.SheetTab) {
			tab.Rows[1].Formats = map[string]models.SheetCellFormat{"a": {Note: "keep"}}
		}, 2},
		{"merge", func(tab *models.SheetTab) {
			tab.Merges = models.SheetMerges{{StartRow: 1, RowSpan: 2, StartCol: 0, ColSpan: 1}}
		}, 3},
		{"full", func(tab *models.SheetTab) { tab.Rows[3].Cells["a"] = "keep" }, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tab := models.SheetTab{Rows: models.DefaultSheetRows(nil, 4)}
			tc.setup(&tab)
			before := string(raw(tab.Rows[:tc.want]))
			row := models.SheetRow{ID: "new", Cells: map[string]string{"receipt": "receipt-id"}}
			got := appendReceiptRow(&tab, row)
			if got != tc.want || tab.Rows[got].Cells["receipt"] != "receipt-id" {
				t.Fatalf("got row %d, want %d", got, tc.want)
			}
			if string(raw(tab.Rows[:tc.want])) != before {
				t.Fatal("existing layout changed")
			}
		})
	}
}

// The user's receipt has six food/drink lines (2143) and a bag (4).
type missingBagCompleter struct {
	t            *testing.T
	calls        int
	date         string
	recheckError bool
}

func (p *missingBagCompleter) Complete(ctx context.Context, messages []WireMessage, tools []any, search bool) (WireMessage, error) {
	p.calls++
	if p.calls == 2 && p.recheckError {
		return WireMessage{}, fmt.Errorf("recheck unavailable")
	}
	if search || len(tools) != 0 || !messages[0].Sensitive || len(messages[1].ImageURLs) != 1 {
		p.t.Fatal("receipt recheck must retain private image routing")
	}
	r := ReceiptDraft{Merchant: "業務スーパー", Date: p.date, Currency: "JPY", Subtotal: "2147", Tax: "171", Total: "2318"}
	for i, amount := range []string{"179", "398", "398", "684", "248", "236"} {
		r.Items = append(r.Items, ReceiptItem{Description: fmt.Sprintf("Printed item %d", i+1), Amount: amount})
	}
	if p.calls == 2 {
		r.Items = append(r.Items, ReceiptItem{Description: "レジ袋NO45小", Quantity: "1", UnitPrice: "4", Amount: "4"})
	}
	return WireMessage{Content: string(raw(imageExtraction{Receipt: &r}))}, nil
}
func TestReceiptExtractionRechecksMissingBag(t *testing.T) {
	p := &missingBagCompleter{t: t, date: "2026-09-30"}
	s := &Service{provider: p}
	result, err := s.extractReceipt(context.Background(), WireMessage{Role: "user", Sensitive: true, ImageURLs: []string{"data:image/jpeg;base64,fixture"}}, "2026-09-30")
	if err != nil {
		t.Fatal(err)
	}
	if p.calls != 2 || len(result.Receipt.Items) != 7 {
		t.Fatalf("missing bag was not rechecked: %d calls, %d items", p.calls, len(result.Receipt.Items))
	}
	if result.Receipt.Date != "2026-09-30" {
		t.Fatal("printed date changed")
	}
	if issues := receiptIssues(*result.Receipt); len(issues) != 0 {
		t.Fatal(issues)
	}
}
func TestReceiptExtractionDefaultsMissingDate(t *testing.T) {
	p := &missingBagCompleter{t: t}
	s := &Service{provider: p}
	result, err := s.extractReceipt(context.Background(), WireMessage{Role: "user", Sensitive: true, ImageURLs: []string{"data:image/jpeg;base64,fixture"}}, "2026-10-01")
	if err != nil {
		t.Fatal(err)
	}
	if result.Receipt.Date != "2026-10-01" {
		t.Fatalf("missing date = %q, want local today", result.Receipt.Date)
	}
}

func TestReceiptExtractionFailedRecheckKeepsReview(t *testing.T) {
	p := &missingBagCompleter{t: t, date: "2026-09-30", recheckError: true}
	s := &Service{provider: p}
	result, err := s.extractReceipt(context.Background(), WireMessage{Role: "user", Sensitive: true, ImageURLs: []string{"data:image/jpeg;base64,fixture"}}, "2026-10-01")
	if err != nil {
		t.Fatal(err)
	}
	if p.calls != 2 || len(result.Receipt.Items) != 6 || result.Receipt.Total != "2318" || len(result.Receipt.Issues) == 0 {
		t.Fatal("failed recheck must preserve the original amounts and flag the mismatch")
	}
}
func TestReceiptExtractionBalancedReceiptNeedsNoRecheck(t *testing.T) {
	s := &Service{provider: receiptCompleter{t}}
	result, err := s.extractReceipt(context.Background(), WireMessage{Role: "user", Sensitive: true, ImageURLs: []string{"data:image/jpeg;base64,fixture"}}, "2026-10-01")
	if err != nil {
		t.Fatal(err)
	}
	if result.Receipt.Date != "2026-09-29" || len(result.Receipt.Issues) != 0 {
		t.Fatal("balanced receipt or printed date changed")
	}
}
