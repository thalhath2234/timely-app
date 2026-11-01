package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"timely-api/internal/models"
)

func countReceiptConfirmations(c Conversation) int {
	n := 0
	for _, m := range c.Messages {
		if m.Content == tr("", txtReceiptConfirmed) {
			n++
		}
	}
	return n
}

// Stopped after the last change was saved: Try again finishes the apply and
// runs the next batch, instead of offering an Apply that can only fail
// (GC31).
func TestIntegrationRetryFinishesAPlanThatWasFullyApplied(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	c := runFixture(t, db, []Step{{Tool: "create_task", Summary: "Race A", Arguments: raw(map[string]string{"name": "Race A"}), Status: "done"}})
	proposal := message("assistant", "Create Race A")
	proposal.Proposal, proposal.Remaining = true, "Create a task called Race B"
	c.Messages = []Message{message("user", "Create Race A and Race B"), proposal, notice(tr("", txtStopped))}
	c.Status, c.Lease = "stopped", ""
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	e := imageRoutes(s, c.UserID)
	code, row := routeCall(t, e, "POST", "/chats/"+c.ID+"/retry", "")
	if code != 200 || row.Status != "queued" || row.Phase != "apply" {
		t.Fatalf("retry: %d status %q phase %q", code, row.Status, row.Phase)
	}
	// The user id is not in the JSON answer.
	row.UserID, row.Status, row.Lease = c.UserID, "running", "test-lease"
	if err := db.Save(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.apply(context.Background(), &row); err != nil {
		t.Fatal(err)
	}
	last := row.Messages[len(row.Messages)-1]
	if row.Status != "queued" || row.Phase != "plan" || last.Continue != "Create a task called Race B" {
		t.Fatalf("the next batch did not run: status %q phase %q last %+v", row.Status, row.Phase, last)
	}
}

// Approving a receipt again after a failed apply adds no second
// confirmation (GC31).
func TestIntegrationReceiptIsConfirmedOnce(t *testing.T) {
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	db := integrationDB(t)
	s := New(db, nil, nil)
	r := receiptFixture()
	c := runFixture(t, db, []Step{{Tool: "update_sheet", Summary: "Record it", Arguments: raw(map[string]string{}), Status: "pending"}})
	c.Status, c.Lease = "approval", ""
	c.ImageReview = &ImageReview{Status: "review", ReceiptID: "r1", Receipt: &r, Destination: &ReceiptDestination{SheetID: "s"}}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	e := imageRoutes(s, c.UserID)
	code, row := routeCall(t, e, "POST", "/chats/"+c.ID+"/approve", fmt.Sprintf(`{"revision":%d}`, c.Revision))
	if code != 200 || countReceiptConfirmations(row) != 1 {
		t.Fatalf("approve: %d, %d confirmations", code, countReceiptConfirmations(row))
	}
	// The apply fails (a provider key was removed, say) and is retried.
	row.UserID, row.Status, row.Error = c.UserID, "failed", "Anthropic is not connected"
	if err := db.Save(&row).Error; err != nil {
		t.Fatal(err)
	}
	if code, row = routeCall(t, e, "POST", "/chats/"+c.ID+"/retry", ""); code != 200 || row.Status != "approval" {
		t.Fatalf("retry: %d %q", code, row.Status)
	}
	code, row = routeCall(t, e, "POST", "/chats/"+c.ID+"/approve", fmt.Sprintf(`{"revision":%d}`, row.Revision))
	if code != 200 || countReceiptConfirmations(row) != 1 {
		t.Fatalf("second approve: %d, %d confirmations", code, countReceiptConfirmations(row))
	}
}

// A possible duplicate is a choice in the review, not a failure card; a
// sheet deleted after review is a plain 409 with what to do (GC24).
func TestIntegrationDuplicateIsAChoiceAndADeletedSheetIsNamed(t *testing.T) {
	db := integrationDB(t)
	s := New(db, fakeSheetCatalog, nil)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(ptr(householdSheet("user-a"))).Error; err != nil {
		t.Fatal(err)
	}
	r := receiptFixture()
	r.Merchant, r.Date = "CORNER SHOP #12", "2026-09-28"
	c := runFixture(t, db, nil)
	c.ImageReview = &ImageReview{Status: "review", ReceiptID: "r2", Receipt: &r, Destination: &ReceiptDestination{SheetID: "household"}}
	if err := s.buildReceiptProposal(context.Background(), db, &c); err != nil {
		t.Fatal(err)
	}
	last := c.Messages[len(c.Messages)-1]
	if c.Error != "" || c.Status != "idle" || len(c.ImageReview.Duplicates) != 1 || last.Kind != "notice" || last.Content != tr("", txtReceiptDuplicate) {
		t.Fatalf("duplicate shown as a failure: error %q status %q last %+v", c.Error, c.Status, last)
	}
	gone := runFixture(t, db, nil)
	gone.ImageReview = &ImageReview{Status: "review", ReceiptID: "r3", Receipt: ptr(receiptFixture()), Destination: &ReceiptDestination{SheetID: "sht_deleted"}}
	err := s.buildReceiptProposal(context.Background(), db, &gone)
	var refused *echo.HTTPError
	if !errors.As(err, &refused) || refused.Code != 409 || !strings.Contains(fmt.Sprint(refused.Message), "no longer exists") {
		t.Fatalf("deleted sheet: %v", err)
	}
	// Through the run, the message reads without the HTTP code.
	gone.Status = "running"
	if err := db.Save(&gone).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.refreshReceipt(context.Background(), &gone); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(gone.Error, "code=") || !strings.Contains(gone.Error, "That sheet no longer exists") {
		t.Fatalf("refresh error %q", gone.Error)
	}
}

// A stale review page is refused before the column question goes to Jev
// (GC16).
func TestIntegrationStaleReceiptIsRefusedBeforeAskingJev(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(ptr(householdSheet("user-a"))).Error; err != nil {
		t.Fatal(err)
	}
	jev, bodies := jevBy(t, func(string, string) any { return nil })
	s := New(db, fakeSheetCatalog, nil)
	s.SetDecisions(jev)
	r := receiptFixture()
	c := runFixture(t, db, nil)
	c.Status, c.Lease, c.Revision = "idle", "", 7
	c.ImageReview = &ImageReview{Status: "review", ReceiptID: "r4", Receipt: &r}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"revision":3,"receipt":%s,"destination":{"sheetId":"household","expenseTabId":"spend"}}`, raw(r))
	if code, _ := routeCall(t, imageRoutes(s, c.UserID), "POST", "/chats/"+c.ID+"/receipt", body); code != 409 {
		t.Fatalf("stale receipt: %d", code)
	}
	if len(*bodies) != 0 {
		t.Fatalf("Jev was asked %d times for a stale page", len(*bodies))
	}
}

// A message typed during the review carries the form's unsaved edits, so
// the revision starts from them (GC29).
func TestIntegrationMessageCarriesUnsavedReceiptEdits(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	r := receiptFixture()
	c := runFixture(t, db, nil)
	c.Status, c.Lease, c.Phase = "idle", "", "review"
	c.ImageReview = &ImageReview{Status: "review", ReceiptID: "r5", Receipt: &r}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	edited := receiptFixture()
	edited.Merchant = "Lidl Berlin"
	body := fmt.Sprintf(`{"content":"bread was 2.50","imageIds":[],"receipt":%s}`, raw(edited))
	code, row := routeCall(t, imageRoutes(s, c.UserID), "POST", "/chats/"+c.ID+"/messages", body)
	if code != 200 || row.Phase != "receipt_edit" || row.ImageReview.Receipt.Merchant != "Lidl Berlin" {
		t.Fatalf("edits lost: %d phase %q merchant %q", code, row.Phase, row.ImageReview.Receipt.Merchant)
	}
}

// Try again from another device runs in that device's zone and app (GC17).
func TestIntegrationRetryTakesTheRetryingDevice(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	c := runFixture(t, db, nil)
	c.Status, c.Lease, c.Phase, c.Error = "failed", "", "plan", "Anthropic is unavailable right now (HTTP 529)"
	c.Timezone, c.Client = "Asia/Tokyo", "phone"
	c.Messages = []Message{message("user", "Plan my week")}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	code, row := routeCall(t, imageRoutes(s, c.UserID), "POST", "/chats/"+c.ID+"/retry", `{"timezone":"Europe/Berlin","client":"web","ui":"openui-1"}`)
	if code != 200 || row.Timezone != "Europe/Berlin" || row.Client != "web" || !row.RichUI || row.Status != "queued" {
		t.Fatalf("retry kept the old device: %d %q %q rich=%v %q", code, row.Timezone, row.Client, row.RichUI, row.Status)
	}
}

// Only a category the person already uses is pre-filled (GC23).
func TestIntegrationUnofferedCategoryIsDropped(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(ptr(householdSheet("user-a"))).Error; err != nil {
		t.Fatal(err)
	}
	jev, _ := jevBy(t, func(id, _ string) any {
		if id == "category" {
			return choice("Bribes", 0.95)
		}
		return nil
	})
	s := New(db, fakeSheetCatalog, nil)
	s.SetDecisions(jev)
	c := runFixture(t, db, nil)
	r := receiptFixture()
	hints, _ := s.receiptHints(context.Background(), &c, &r, true)
	if r.Category == "Bribes" || strings.Contains(strings.Join(hints, " "), "Bribes") {
		t.Fatalf("an unoffered category was applied: %q %v", r.Category, hints)
	}
}
