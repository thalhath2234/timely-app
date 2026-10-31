package suggest

import (
	"context"
	"errors"
	"strings"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/models"
)

// A doc's Goes to: where every task made from its Make task offers goes,
// when the person picked it. "inbox" is no project; anything else is a
// project id. With no pick the place stays automatic (DocChecklist). The
// doc's own project is left alone: the pick is about the tasks, not the doc.

const offerTargetInbox = "inbox"

// errNotAPlace: the picked project is not one of the person's open projects.
var errNotAPlace = errors.New("not a place for tasks")

func (s *Service) docGoesTo(c *echo.Context) error {
	var in struct {
		Target string `json:"target"`
	}
	if err := c.Bind(&in); err != nil || len(in.Target) > 200 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	err := s.SetDocOfferTarget(c.Request().Context(), user(c), c.Param("id"), in.Target)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Doc not found")
	}
	if errors.Is(err, errNotAPlace) {
		return echo.NewHTTPError(400, "Pick one of your open projects")
	}
	if err != nil {
		return err
	}
	return c.NoContent(204)
}

// SetDocOfferTarget keeps where tasks from the person's doc go: "inbox", a
// project id, or "" to go back to the automatic place. The doc check and the
// write are one statement each, so a doc deleted meanwhile is a 404, not a
// foreign key error.
func (s *Service) SetDocOfferTarget(ctx context.Context, userID, docID, target string) error {
	db := s.db.WithContext(ctx)
	target = strings.TrimSpace(target)
	if target == "" {
		var owned int64
		if err := db.Model(&models.Document{}).Where("id = ? AND user_id = ?", docID, userID).Count(&owned).Error; err != nil {
			return err
		}
		if owned == 0 {
			return gorm.ErrRecordNotFound
		}
		return db.Exec(`DELETE FROM doc_offer_targets WHERE doc_id = ? AND user_id = ?`, docID, userID).Error
	}
	if target != offerTargetInbox {
		if _, err := s.openProject(ctx, userID, target); errors.Is(err, gorm.ErrRecordNotFound) {
			return errNotAPlace
		} else if err != nil {
			return err
		}
	}
	res := db.Exec(`INSERT INTO doc_offer_targets (doc_id, user_id, target, updated_at)
		SELECT id, user_id, ?, now() FROM documents WHERE id = ? AND user_id = ?
		ON CONFLICT (doc_id) DO UPDATE SET target = EXCLUDED.target, updated_at = now()`, target, docID, userID)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// docOfferTarget is the doc's saved pick, "" when there is none.
func (s *Service) docOfferTarget(ctx context.Context, userID, docID string) (string, error) {
	var targets []string
	err := s.db.WithContext(ctx).Table("doc_offer_targets").Where("doc_id = ? AND user_id = ?", docID, userID).Limit(1).Pluck("target", &targets).Error
	if err != nil || len(targets) == 0 {
		return "", err
	}
	return targets[0], nil
}

// openProject is one of the person's projects that is not finished: the only
// kind new tasks can go to.
func (s *Service) openProject(ctx context.Context, userID, projectID string) (ChecklistProject, error) {
	var p ChecklistProject
	err := s.db.WithContext(ctx).Table("projects").
		Select("projects.id", "projects.title", "projects.workspace_id").
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("projects.id = ? AND workspaces.user_id = ? AND projects.completed_at IS NULL", projectID, userID).
		Take(&p).Error
	return p, err
}
