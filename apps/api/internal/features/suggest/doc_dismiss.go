package suggest

import (
	"context"
	"errors"
	"strings"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/models"
)

// A dismissed doc suggestion stays dismissed for that doc, on every device,
// so the card does not offer the same line as a task each time the doc
// opens.

const maxDocDismissals = 200

// docHintKey names one suggestion of a doc: its kind and what it offers.
// Lines and property values compare as the person reads them, ignoring case
// and spacing, so a dismissed line stays dismissed after a retype.
func docHintKey(kind, value string) string {
	value = strings.ToLower(strings.Join(strings.Fields(value), " "))
	switch kind {
	case "outdated":
		return kind
	case "template", "project", "parent", "type", "prop", "work":
		if value == "" {
			return ""
		}
		return kind + ":" + value
	}
	return ""
}

func (s *Service) docDismiss(c *echo.Context) error {
	var in struct {
		Kind  string `json:"kind"`
		Value string `json:"value"`
	}
	if err := c.Bind(&in); err != nil || len(in.Value) > 400 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	key := docHintKey(in.Kind, in.Value)
	if key == "" {
		return echo.NewHTTPError(400, "Unknown suggestion")
	}
	err := s.DismissDocHint(c.Request().Context(), user(c), c.Param("id"), key)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Doc not found")
	}
	if err != nil {
		return err
	}
	return c.NoContent(204)
}

// DismissDocHint keeps one dismissed suggestion of the person's doc, at most
// maxDocDismissals per doc.
func (s *Service) DismissDocHint(ctx context.Context, userID, docID, key string) error {
	var doc models.Document
	if err := s.db.WithContext(ctx).Select("id").Where("id = ? AND user_id = ?", docID, userID).First(&doc).Error; err != nil {
		return err
	}
	return s.db.WithContext(ctx).Exec(`INSERT INTO doc_hint_dismissals (doc_id, hint, user_id)
		SELECT ?, ?, ? WHERE (SELECT count(*) FROM doc_hint_dismissals WHERE doc_id = ?) < ?
		ON CONFLICT (doc_id, hint) DO NOTHING`, doc.ID, key, userID, doc.ID, maxDocDismissals).Error
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
