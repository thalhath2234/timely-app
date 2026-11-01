package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

func routeCall(t *testing.T, e *echo.Echo, method, path, body string) (int, Conversation) {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.ServeHTTP(w, r)
	var row Conversation
	_ = json.Unmarshal(w.Body.Bytes(), &row)
	return w.Code, row
}

type brokenCompleters struct{}

func (brokenCompleters) Resolve(context.Context, string) (string, string, error) {
	return "anthropic", "test-model", nil
}

func (brokenCompleters) Completer(context.Context, string, string, string) (Completer, error) {
	return nil, errors.New("Anthropic API is not connected. Add its key in Settings → Agent")
}

// A failed run stores what the person can do; Try again clears it (GC20).
func TestIntegrationFailedRunSaysWhatToDo(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	s.SetCompleters(brokenCompleters{})
	c := runFixture(t, db, nil)
	c.Status, c.Lease, c.Phase = "queued", "", "plan"
	c.Messages = []Message{message("user", "hi")}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.work(ctx)
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if db.First(&c, "id = ?", c.ID); c.Status == "failed" {
			break
		}
	}
	cancel()
	if c.Status != "failed" || c.ErrorAction != ActionSettings {
		t.Fatalf("status %q action %q error %q", c.Status, c.ErrorAction, c.Error)
	}
	_, row := routeCall(t, imageRoutes(s, c.UserID), "POST", "/chats/"+c.ID+"/retry", "")
	var stored Conversation
	db.First(&stored, "id = ?", c.ID)
	if row.ErrorAction != "" || stored.ErrorAction != "" {
		t.Fatalf("retry kept the action: %q / %q", row.ErrorAction, stored.ErrorAction)
	}
}

type answerOnce struct {
	answer string
	calls  int
}

func (a *answerOnce) Complete(context.Context, []WireMessage, []any, bool) (WireMessage, error) {
	a.calls++
	return WireMessage{Content: a.answer}, nil
}

func extractFixture(t *testing.T, db *gorm.DB) Conversation {
	t.Helper()
	c := runFixture(t, db, nil)
	c.Messages = []Message{message("user", "Process these images")}
	c.Phase = "extract"
	a := ImageAttachment{ID: id("img_"), UserID: c.UserID, ConversationID: &c.ID, Name: "Receipt", ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now()}
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
	return c
}

// Reading photos: an empty answer is not shown as an empty bubble, a missing
// date is the person's today in their device zone and flagged, and a review
// discarded while the photos were read is never sent (GC21, GC22,
// RV-images-2).
func TestIntegrationExtractionEdgeCases(t *testing.T) {
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	db := integrationDB(t)

	empty := &answerOnce{answer: `{"text":"","receipt":null}`}
	c := extractFixture(t, db)
	if err := New(db, nil, empty).extractImages(context.Background(), &c); err == nil || !strings.Contains(err.Error(), "Nothing readable") {
		t.Fatalf("empty extraction: %v", err)
	}

	undated := receiptFixture()
	undated.Date = ""
	dated := &answerOnce{answer: string(raw(imageExtraction{Text: "Corner Shop", Receipt: &undated}))}
	c = extractFixture(t, db)
	c.Timezone = "Pacific/Kiritimati"
	if err := New(db, nil, dated).extractImages(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	kiritimati, _ := time.LoadLocation("Pacific/Kiritimati")
	if want := time.Now().In(kiritimati).Format("2006-01-02"); c.ImageReview.Receipt.Date != want || !contains(c.ImageReview.Receipt.Issues, dateAssumed) {
		t.Fatalf("date %q (want %q) issues %v", c.ImageReview.Receipt.Date, want, c.ImageReview.Receipt.Issues)
	}

	discarded := &answerOnce{answer: string(raw(imageExtraction{Receipt: ptr(receiptFixture())}))}
	c = extractFixture(t, db)
	if err := db.Model(&Conversation{}).Where("id = ?", c.ID).Updates(map[string]any{"status": "idle", "lease": ""}).Error; err != nil {
		t.Fatal(err)
	}
	if err := New(db, nil, discarded).extractImages(context.Background(), &c); !errors.Is(err, context.Canceled) || discarded.calls != 0 {
		t.Fatalf("discarded review: err %v, %d model calls", err, discarded.calls)
	}
}
