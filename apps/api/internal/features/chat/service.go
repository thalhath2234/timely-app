package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"timely-api/internal/features/agent"
	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Service struct {
	db       *gorm.DB
	factory  func(*gorm.DB) agent.Catalog
	provider Completer
}

func New(db *gorm.DB, factory func(*gorm.DB) agent.Catalog, provider Completer) *Service {
	return &Service{db: db, factory: factory, provider: provider}
}
func id(prefix string) string { return prefix + uuid.NewString() }
func message(role, content string) Message {
	return Message{ID: id("msg_"), Role: role, Content: content, CreatedAt: time.Now().UTC()}
}
func (s *Service) Routes(g *echo.Group) {
	g.POST("/chats/images", s.uploadImage)
	g.GET("/chats/images/:imageId", s.getImage)
	g.DELETE("/chats/images/:imageId", s.deleteImage)
	g.POST("/chats/:id/receipt", s.receiptProposal)
	g.POST("/chats/:id/images/discard", s.discardReview)
	g.POST("/chats/:id/images/confirm", s.confirmImageReview)
	g.GET("/chats", s.list)
	g.POST("/chats", s.create)
	g.GET("/chats/:id", s.get)
	g.POST("/chats/:id/messages", s.send)
	g.POST("/chats/:id/approve", s.approve)
	g.POST("/chats/:id/stop", s.stop)
	g.POST("/chats/:id/retry", s.retry)
	g.POST("/chats/:id/read", s.read)
	g.PATCH("/chats/:id", s.configure)
}
func user(c *echo.Context) string { v, _ := c.Get("userID").(string); return v }
func (s *Service) find(db *gorm.DB, uid, cid string, c *Conversation) error {
	if uid == "" {
		return echo.NewHTTPError(401, "Sign in to use chat")
	}
	err := db.Where("id = ? AND user_id = ?", cid, uid).First(c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Conversation not found")
	}
	return err
}
func (s *Service) list(c *echo.Context) error {
	rows := []Conversation{}
	err := s.db.Select("id", "title", "status", "phase", "web_search", "revision", "unread", "error", "created_at", "updated_at").Where("user_id = ?", user(c)).Order("updated_at DESC").Limit(200).Find(&rows).Error
	if err != nil {
		return err
	}
	return c.JSON(200, rows)
}
func (s *Service) get(c *echo.Context) error {
	var row Conversation
	if err := s.find(s.db, user(c), c.Param("id"), &row); err != nil {
		return err
	}
	s.fillImages(&row)
	return c.JSON(200, row)
}

type sendInput struct {
	ImageIDs  []string      `json:"imageIds"`
	Content   string        `json:"content"`
	Context   []ContextChip `json:"context"`
	WebSearch bool          `json:"webSearch"`
}

func validateInput(in sendInput) error {
	if (len(strings.TrimSpace(in.Content)) == 0 && len(in.ImageIDs) == 0) || len(in.Content) > 16000 {
		return echo.NewHTTPError(400, "Message must be between 1 and 16,000 characters")
	}
	if len(in.ImageIDs) > 5 {
		return echo.NewHTTPError(400, "Attach up to five photos of one receipt")
	}
	if len(in.Context) > 8 {
		return echo.NewHTTPError(400, "Too many context attachments")
	}
	for _, c := range in.Context {
		if len(c.Value) > 12000 || len(c.Label) > 200 || len(c.Kind) > 30 {
			return echo.NewHTTPError(400, "Context attachment is too large")
		}
	}
	return nil
}
func (s *Service) create(c *echo.Context) error {
	var in sendInput
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid message")
	}
	if err := validateInput(in); err != nil {
		return err
	}
	if in.Context == nil {
		in.Context = []ContextChip{}
	}
	if strings.TrimSpace(in.Content) == "" {
		in.Content = "Process these images"
	}
	title := []rune(strings.TrimSpace(in.Content))
	if len(title) > 70 {
		title = title[:70]
	}
	row := Conversation{ID: id("chat_"), UserID: user(c), Title: string(title), Status: "queued", Phase: "plan", WebSearch: in.WebSearch, Context: in.Context, Messages: []Message{message("user", in.Content)}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if err := attachImages(tx, &row, in.ImageIDs); err != nil {
			return err
		}
		return tx.Save(&row).Error
	}); err != nil {
		return err
	}
	s.fillImages(&row)
	return c.JSON(201, row)
}
func (s *Service) change(c *echo.Context, fn func(*gorm.DB, *Conversation) error) error {
	var row Conversation
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {
			return err
		}
		if err := fn(tx, &row); err != nil {
			return err
		}
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil {
		return err
	}
	s.fillImages(&row)
	return c.JSON(200, row)
}
func busy(c *Conversation) bool { return c.Status == "queued" || c.Status == "running" }
func archivePlan(c *Conversation) {
	if len(c.Plan) > 0 {
		m := message("assistant", "Previous changes")
		m.Steps = c.Plan
		c.Messages = append(c.Messages, m)
	}
	c.Plan = []Step{}
	c.Snapshots = []Snapshot{}
	c.Transcript = []WireMessage{}
}
func (s *Service) send(c *echo.Context) error {
	var in sendInput
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid message")
	}
	if err := validateInput(in); err != nil {
		return err
	}
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if busy(row) {
			return echo.NewHTTPError(409, "Stop or wait for the current run before sending another message")
		}
		if len(row.Messages) > 150 {
			return echo.NewHTTPError(400, "Start a new chat to continue")
		}
		if len(in.ImageIDs) > 0 && row.ImageReview != nil && row.ImageReview.Status != "confirmed" && row.ImageReview.Status != "discarded" {
			return echo.NewHTTPError(409, "Confirm or discard the current image review first")
		}
		if strings.TrimSpace(in.Content) == "" {
			in.Content = "Process these images"
		}
		row.ForceReview = row.Status == "approval" || row.Sensitive
		archivePlan(row)
		row.Messages = append(row.Messages, message("user", in.Content))
		row.Status = "queued"
		row.Phase = "plan"
		if len(in.ImageIDs) == 0 && row.ImageReview != nil && row.ImageReview.Status == "extracting" {
			row.Phase = "extract"
		} else if len(in.ImageIDs) == 0 && row.ImageReview != nil && row.ImageReview.Receipt != nil && row.ImageReview.Status == "review" {
			row.Phase = "receipt_edit"
		}
		row.Error = ""
		row.Unread = false
		return attachImages(tx, row, in.ImageIDs)
	})
}
func (s *Service) approve(c *echo.Context) error {
	var in struct {
		Revision int `json:"revision"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid approval")
	}
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if row.Status != "approval" || row.Revision != in.Revision {
			return echo.NewHTTPError(409, "This proposal changed. Review the latest version before applying")
		}
		if row.ImageReview != nil && row.ImageReview.Status != "discarded" {
			if err := eraseImages(tx, row.UserID, row.ImageReview.ImageIDs); err != nil {
				return err
			}
			row.ImageReview.Status = "confirmed"
			if row.ImageReview.Receipt != nil {
				m := message("assistant", "Receipt details confirmed. Temporary images removed.")
				m.Receipt = row.ImageReview.Receipt
				row.Messages = append(row.Messages, m)
			}
		}
		row.Phase = "apply"
		row.Status = "queued"
		row.Error = ""
		row.Unread = false
		return nil
	})
}
func (s *Service) stop(c *echo.Context) error {
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if busy(row) || row.Status == "approval" {
			row.Status = "stopped"
			row.Lease = ""
			row.LeaseUntil = nil
			row.Messages = append(row.Messages, message("assistant", "Stopped. Completed changes are kept."))
		}
		return nil
	})
}
func (s *Service) retry(c *echo.Context) error {
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if row.Status != "failed" && row.Status != "stopped" {
			return echo.NewHTTPError(409, "This run cannot be retried")
		}
		row.Error = ""
		row.Unread = false
		if row.Phase == "apply" && len(row.Plan) > 0 {
			row.Status = "approval"
			for i := range row.Plan {
				if row.Plan[i].Status != "done" {
					row.Plan[i].Status = "pending"
					row.Plan[i].Error = ""
				}
			}
		} else {
			row.Status = "queued"
			if row.ImageReview != nil && (row.Phase == "receipt_plan" || row.Phase == "receipt_edit") {
				// Resume the same reviewed-data operation, not the general tool loop.
			} else if row.ImageReview != nil && row.ImageReview.Status == "extracting" {
				row.Phase = "extract"
			} else {
				row.Phase = "plan"
			}
			row.Transcript = []WireMessage{}
		}
		return nil
	})
}
func (s *Service) read(c *echo.Context) error { // Reading must not invalidate proposal revisions.
	var row Conversation
	if err := s.find(s.db, user(c), c.Param("id"), &row); err != nil {
		return err
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Conversation{}).Where("id = ? AND user_id = ?", row.ID, row.UserID).UpdateColumn("unread", false).Error; err != nil {
			return err
		}
		return tx.Model(&models.Notification{}).Where("user_id = ? AND entity_type = 'chat' AND entity_id = ? AND read_at IS NULL", row.UserID, row.ID).Update("read_at", time.Now().UTC()).Error
	})
	if err != nil {
		return err
	}
	return c.NoContent(204)
}
func (s *Service) configure(c *echo.Context) error {
	var in struct {
		WebSearch bool          `json:"webSearch"`
		Context   []ContextChip `json:"context"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid settings")
	}
	if err := validateInput(sendInput{Content: "context", Context: in.Context}); err != nil {
		return err
	}
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if busy(row) {
			return echo.NewHTTPError(409, "Wait or stop before changing context")
		}
		row.WebSearch = in.WebSearch
		row.Context = in.Context
		if row.Context == nil {
			row.Context = []ContextChip{}
		}
		return nil
	})
}
func notify(tx *gorm.DB, c *Conversation, body string) error {
	c.Unread = true
	kind := "chat"
	key := fmt.Sprintf("%s:%d:%s", c.ID, c.Revision, c.Status)
	n := models.Notification{ID: id("ntf_"), UserID: c.UserID, Category: "agent", Title: c.Title, Body: body, EntityType: &kind, EntityID: &c.ID, DedupeKey: &key, Data: models.JobPayload{"status": c.Status}, CreatedAt: time.Now().UTC()}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&n).Error
}

// A fenced lease prevents a stopped or recovered worker from publishing results.
func (s *Service) checkpoint(ctx context.Context, c *Conversation, fn func(*gorm.DB, *Conversation) error) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var latest Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), c.UserID, c.ID, &latest); err != nil {
			return err
		}
		if latest.Lease != c.Lease || latest.Status != "running" {
			return context.Canceled
		}
		if err := fn(tx, &latest); err != nil {
			return err
		}
		leaseUntil := time.Now().UTC().Add(3 * time.Minute)
		latest.LeaseUntil = &leaseUntil
		latest.Revision++
		if err := tx.Save(&latest).Error; err != nil {
			return err
		}
		*c = latest
		return nil
	})
}
