package suggest

import (
	"context"
	"errors"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/models"
)

// A dismissed doc suggestion stays dismissed for that doc, on every device,
// so the card does not offer the same line as a task each time the doc
// opens. "todo" is one checklist item offered as a task and "todos" all of
// them: the doc's "Offer tasks from checklists" switch, which can be turned
// back on.

const maxDocDismissals = 200

// errDocDismissalsFull: the doc already keeps maxDocDismissals dismissals.
var errDocDismissalsFull = errors.New("doc dismissals full")

// docHintKey names one suggestion of a doc: its kind and what it offers.
// Lines and property values compare as the person reads them, ignoring case
// and spacing, so a dismissed line stays dismissed after a retype.
func docHintKey(kind, value string) string {
	value = strings.ToLower(strings.Join(strings.Fields(value), " "))
	switch kind {
	case "outdated", "todos":
		return kind
	case "template", "project", "parent", "type", "prop", "work", "todo":
		if value == "" {
			return ""
		}
		return kind + ":" + value
	}
	return ""
}

// docDismiss keeps a dismissal (POST) or takes it back (DELETE: an undo, or
// the doc's task offers turned on again).
func (s *Service) docDismiss(c *echo.Context) error {
	var in struct {
		Kind  string `json:"kind"`
		Value string `json:"value"`
	}
	// Counted in characters: a checklist item's name is up to 200 of them.
	if err := c.Bind(&in); err != nil || utf8.RuneCountInString(in.Value) > 400 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	key := docHintKey(in.Kind, in.Value)
	if key == "" {
		return echo.NewHTTPError(400, "Unknown suggestion")
	}
	var err error
	if c.Request().Method == "DELETE" {
		err = s.RestoreDocHint(c.Request().Context(), user(c), c.Param("id"), key)
	} else {
		err = s.DismissDocHint(c.Request().Context(), user(c), c.Param("id"), key)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Doc not found")
	}
	if errors.Is(err, errDocDismissalsFull) {
		return echo.NewHTTPError(409, "This doc has too many dismissed suggestions")
	}
	if err != nil {
		return err
	}
	return c.NoContent(204)
}

// DismissDocHint keeps one dismissed suggestion of the person's doc, at most
// maxDocDismissals per doc. The doc's task offers turned off ("todos") is a
// setting rather than a dismissal, so it is always kept.
func (s *Service) DismissDocHint(ctx context.Context, userID, docID, key string) error {
	var doc models.Document
	if err := s.db.WithContext(ctx).Select("id").Where("id = ? AND user_id = ?", docID, userID).First(&doc).Error; err != nil {
		return err
	}
	limit := maxDocDismissals
	if key == "todos" {
		limit = math.MaxInt32
	}
	res := s.db.WithContext(ctx).Exec(`INSERT INTO doc_hint_dismissals (doc_id, hint, user_id)
		SELECT ?, ?, ? WHERE (SELECT count(*) FROM doc_hint_dismissals WHERE doc_id = ?) < ?
		ON CONFLICT (doc_id, hint) DO NOTHING`, doc.ID, key, userID, doc.ID, limit)
	if res.Error != nil || res.RowsAffected > 0 {
		return res.Error
	}
	// Nothing new: kept already, or the doc is full.
	var kept int64
	if err := s.db.WithContext(ctx).Table("doc_hint_dismissals").Where("doc_id = ? AND hint = ?", doc.ID, key).Count(&kept).Error; err != nil {
		return err
	}
	if kept == 0 {
		return errDocDismissalsFull
	}
	return nil
}

// RestoreDocHint forgets one dismissed suggestion of the person's doc.
func (s *Service) RestoreDocHint(ctx context.Context, userID, docID, key string) error {
	var doc models.Document
	if err := s.db.WithContext(ctx).Select("id").Where("id = ? AND user_id = ?", docID, userID).First(&doc).Error; err != nil {
		return err
	}
	return s.db.WithContext(ctx).Exec(`DELETE FROM doc_hint_dismissals WHERE doc_id = ? AND hint = ? AND user_id = ?`, doc.ID, key, userID).Error
}

// docDismissed are the keys of the doc's dismissed suggestions.
func (s *Service) docDismissed(ctx context.Context, userID, docID string) map[string]bool {
	var keys []string
	s.db.WithContext(ctx).Table("doc_hint_dismissals").Where("doc_id = ? AND user_id = ?", docID, userID).Pluck("hint", &keys)
	out := make(map[string]bool, len(keys))
	for _, k := range keys {
		out[k] = true
	}
	return out
}
