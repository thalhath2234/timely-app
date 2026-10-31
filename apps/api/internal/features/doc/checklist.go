package doc

import (
	"errors"
	"net/http"
	"sync"
	"timely-api/internal/models"
	"timely-api/internal/richtext"

	"github.com/labstack/echo/v5"
)

// Ticks from outside the editor: a CheckRow on a dashboard card, in a live
// block or in an agent reply ticks one checklist item in a doc. The server
// changes that one item in the doc as it is now, so a card drawn from an
// older copy never writes the rest of the doc back.

// ChecklistTick is PUT /docs/:id/checklist: the item by its place among the
// doc's checklist items and its words (ChecklistTickRequest in the contract).
type ChecklistTick struct {
	Item int    `json:"item"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// ErrNoChecklistItem is a tick for an item the doc no longer has.
var ErrNoChecklistItem = errors.New("the doc no longer has this item")

// checklistLocks holds a lock per doc, so two quick ticks on one list read
// and save the doc one after the other and neither undoes the other.
var checklistLocks sync.Map

func lockChecklist(documentID string) func() {
	lock, _ := checklistLocks.LoadOrStore(documentID, &sync.Mutex{})
	mu := lock.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// SetChecklistItem ticks or unticks one item, found as richtext.SetChecklistItem
// finds it, and saves the doc like any other edit.
func (s *documentService) SetChecklistItem(userID, documentID string, tick ChecklistTick) (*models.Document, error) {
	defer lockChecklist(documentID)()
	current, err := s.GetByID(userID, documentID)
	if err != nil {
		return nil, err
	}
	content := current.Content
	if content == nil {
		return nil, ErrNoChecklistItem
	}
	_, changed, err := richtext.SetChecklistItem(content, tick.Item, tick.Text, tick.Done)
	if err != nil {
		return nil, ErrNoChecklistItem
	}
	if !changed {
		// Ticked elsewhere already: nothing to save.
		return current, nil
	}
	return s.Update(userID, documentID, DocumentUpdate{Content: &content})
}

func (h *Handler) SetChecklistItem(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var tick ChecklistTick
	if err := decodeJSON(c, &tick); err != nil {
		return err
	}
	document, err := h.documentService.SetChecklistItem(userID, c.Param("id"), tick)
	if errors.Is(err, ErrNoChecklistItem) {
		return echo.NewHTTPError(http.StatusConflict, "The doc no longer has this item. Open the doc to tick it there")
	}
	if err != nil {
		return documentError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"document": document})
}
