package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/sheet"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Service struct {
	db         *gorm.DB
	factory    func(*gorm.DB) agent.Catalog
	rows       func(*gorm.DB) rowFinder
	rehearsal  func(*gorm.DB) agent.Catalog
	provider   Completer
	completers Completers
	decisions  Decider
	wg         sync.WaitGroup
}

// SetRehearsal supplies a catalog without live side effects (no realtime
// broadcasts) for rehearsing proposals in a rolled-back transaction.
func (s *Service) SetRehearsal(factory func(*gorm.DB) agent.Catalog) { s.rehearsal = factory }

func New(db *gorm.DB, factory func(*gorm.DB) agent.Catalog, provider Completer) *Service {
	rows := func(tx *gorm.DB) rowFinder { return sheet.NewRowFinder(sheet.NewSheetRepository(tx)) }
	return &Service{db: db, factory: factory, rows: rows, provider: provider}
}

// SetCompleters switches runs to per-account provider selection. The fixed
// provider passed to New remains the fallback when none is set.
func (s *Service) SetCompleters(c Completers) { s.completers = c }
func id(prefix string) string                 { return prefix + uuid.NewString() }
func message(role, content string) Message {
	return Message{ID: id("msg_"), Role: role, Content: content, CreatedAt: time.Now().UTC()}
}
func notice(content string) Message {
	m := message("assistant", content)
	m.Kind = "notice"
	return m
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
	g.POST("/chats/:id/reject", s.reject)
	g.DELETE("/chats/:id", s.remove)
	g.POST("/chats/:id/stop", s.stop)
	g.POST("/chats/:id/retry", s.retry)
	g.POST("/chats/:id/read", s.read)
	g.PATCH("/chats/:id", s.configure)
	g.POST("/chats/:id/similar", s.similar)
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
	RequestID string        `json:"requestId"`
	ImageIDs  []string      `json:"imageIds"`
	Content   string        `json:"content"`
	Context   []ContextChip `json:"context"`
	WebSearch bool          `json:"webSearch"`
	// Device IANA timezone. The agent uses it when no timezone is saved in
	// Working hours; invalid values are ignored.
	Timezone string `json:"timezone"`
	// Provider and Model pick the model for a new conversation; empty follows
	// the account default.
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

// validChoice checks the shape of a model picked in the chat menu. Whether the
// provider is connected is checked when a run starts, like the default.
func validChoice(provider, model string) error {
	if len(provider) > 40 || len(model) > 200 || strings.ContainsAny(provider+model, " \n\t") {
		return echo.NewHTTPError(400, "Invalid model choice")
	}
	if provider == "" && model != "" {
		return echo.NewHTTPError(400, "Choose a provider for this model")
	}
	return nil
}

func validateInput(in sendInput) error {
	if len(in.RequestID) > 100 {
		return echo.NewHTTPError(400, "Request ID is too long")
	}
	if (len(strings.TrimSpace(in.Content)) == 0 && len(in.ImageIDs) == 0) || utf8.RuneCountInString(in.Content) > 16000 {
		return echo.NewHTTPError(400, "Message must be between 1 and 16,000 characters")
	}
	if len(in.ImageIDs) > 5 {
		return echo.NewHTTPError(400, "Attach up to five photos of one receipt")
	}
	if len(in.Context) > 8 {
		return echo.NewHTTPError(400, "Too many context attachments")
	}
	if err := validChoice(in.Provider, in.Model); err != nil {
		return err
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
	cid := id("chat_")
	if in.RequestID != "" {
		cid = "chat_" + uuid.NewSHA1(uuid.NameSpaceOID, []byte(user(c)+":"+in.RequestID)).String()
	}
	firstMessage := message("user", in.Content)
	firstMessage.RequestID = in.RequestID
	row := Conversation{ID: cid, UserID: user(c), Title: string(title), Status: "queued", Phase: "plan", WebSearch: in.WebSearch, ChosenProvider: in.Provider, ChosenModel: in.Model, Timezone: validTimezone(in.Timezone), Context: in.Context, Messages: []Message{firstMessage}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	noteLanguage(&row, in.Content)
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(&row)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			if err := s.find(tx, user(c), cid, &row); err != nil {
				return err
			}
			if len(row.Messages) == 0 || row.Messages[0].Content != in.Content {
				return echo.NewHTTPError(409, "Request ID was already used for another message")
			}
			return nil
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

var errAlreadySent = errors.New("message already accepted")

func (s *Service) change(c *echo.Context, fn func(*gorm.DB, *Conversation) error) error {
	var row Conversation
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {
			return err
		}
		if err := fn(tx, &row); err != nil {
			if errors.Is(err, errAlreadySent) {
				return nil
			}
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
func busy(c *Conversation) bool   { return c.Status == "queued" || c.Status == "running" }
func archivePlan(c *Conversation) { archivePlanAs(c, tr(c.Language, txtPreviousChanges), "") }

// Pending steps of an archived plan never run; mark them so clients do not show
// them as live work.
func archivePlanAs(c *Conversation, title, pendingStatus string) {
	if len(c.Plan) > 0 {
		m := message("assistant", title)
		m.Kind = "archive"
		for i := range c.Plan {
			if c.Plan[i].Status != "done" && pendingStatus != "" {
				c.Plan[i].Status = pendingStatus
			}
		}
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
		if strings.TrimSpace(in.Content) == "" {
			in.Content = "Process these images"
		}
		if in.RequestID != "" {
			for _, existing := range row.Messages {
				if existing.RequestID == in.RequestID {
					if existing.Content != in.Content {
						return echo.NewHTTPError(409, "Request ID was already used for another message")
					}
					return errAlreadySent
				}
			}
		}
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
		if zone := validTimezone(in.Timezone); zone != "" {
			row.Timezone = zone
		}
		noteLanguage(row, in.Content)
		row.ForceReview = row.Status == "approval" || row.Sensitive
		archivePlan(row)
		nextMessage := message("user", in.Content)
		nextMessage.RequestID = in.RequestID
		row.Messages = append(row.Messages, nextMessage)
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
				m := message("assistant", tr(row.Language, txtReceiptConfirmed))
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
			row.Messages = append(row.Messages, notice(tr(row.Language, txtStopped)))
		}
		return nil
	})
}

// Rejecting a proposal keeps the conversation so the person can ask for a
// different plan; nothing in the plan has been written yet.
func (s *Service) reject(c *echo.Context) error {
	var in struct {
		Revision int `json:"revision"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if row.Status != "approval" {
			return echo.NewHTTPError(409, "There is no proposal waiting for approval")
		}
		if in.Revision != 0 && row.Revision != in.Revision {
			return echo.NewHTTPError(409, "This proposal changed. Review the latest version first")
		}
		archivePlanAs(row, tr(row.Language, txtDiscardedChanges), "discarded")
		row.Status = "idle"
		row.Phase = "plan"
		row.Error = ""
		row.Unread = false
		row.Messages = append(row.Messages, notice(tr(row.Language, txtDiscarded)))
		return nil
	})
}

// Deleting removes history, temporary images and notifications together. A run
// in progress loses its row, so its next checkpoint fails and no result is published.
func (s *Service) remove(c *echo.Context) error {
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {
			return err
		}
		var imageIDs []string
		if err := tx.Model(&ImageAttachment{}).Where("user_id = ? AND conversation_id = ? AND deleted_at IS NULL", row.UserID, row.ID).Pluck("id", &imageIDs).Error; err != nil {
			return err
		}
		if err := eraseImages(tx, row.UserID, imageIDs); err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND entity_type = 'chat' AND entity_id = ?", row.UserID, row.ID).Delete(&models.Notification{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", row.ID, row.UserID).Delete(&Conversation{}).Error
	})
	if err != nil {
		return err
	}
	return c.NoContent(204)
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

// Omitted fields are left unchanged. Renaming is allowed at any time; context
// and web search wait for the current run, which already read them. A model
// choice may change at any time and applies from the next run; provider and
// model are set together, and an empty provider returns to the default.
func (s *Service) configure(c *echo.Context) error {
	var in struct {
		Title     *string        `json:"title"`
		WebSearch *bool          `json:"webSearch"`
		Context   *[]ContextChip `json:"context"`
		Provider  *string        `json:"provider"`
		Model     *string        `json:"model"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid settings")
	}
	if in.Provider != nil {
		model := ""
		if in.Model != nil {
			model = *in.Model
		}
		if err := validChoice(*in.Provider, model); err != nil {
			return err
		}
	} else if in.Model != nil {
		return echo.NewHTTPError(400, "Choose a provider for this model")
	}
	if in.Context != nil {
		if err := validateInput(sendInput{Content: "context", Context: *in.Context}); err != nil {
			return err
		}
	}
	title := ""
	if in.Title != nil {
		title = strings.TrimSpace(*in.Title)
		if title == "" || len([]rune(title)) > 120 {
			return echo.NewHTTPError(400, "Title must be between 1 and 120 characters")
		}
	}
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if (in.Context != nil || in.WebSearch != nil) && busy(row) {
			return echo.NewHTTPError(409, "Wait or stop before changing context")
		}
		if in.Title != nil {
			row.Title = title
		}
		if in.WebSearch != nil {
			row.WebSearch = *in.WebSearch
		}
		if in.Provider != nil {
			row.ChosenProvider, row.ChosenModel = *in.Provider, ""
			if in.Model != nil {
				row.ChosenModel = *in.Model
			}
		}
		if in.Context != nil {
			row.Context = *in.Context
			if row.Context == nil {
				row.Context = []ContextChip{}
			}
		}
		return nil
	})
}
func notify(tx *gorm.DB, c *Conversation, body string) error {
	c.Unread = true
	kind := "chat"
	key := fmt.Sprintf("%s:%d:%s", c.ID, c.Revision, c.Status)
	n := models.Notification{ID: id("ntf_"), UserID: c.UserID, Category: "agent", Title: c.Title, Body: body, EntityType: &kind, EntityID: &c.ID, DedupeKey: &key, Data: models.JobPayload{"status": c.Status}, CreatedAt: time.Now().UTC()}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&n)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return nil
	}
	var config models.Config
	if err := tx.Select("notification_settings", "working_hours").Where("user_id = ?", c.UserID).First(&config).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	settings := config.NotificationSettings.Normalized()
	runAt := time.Now().UTC()
	local := runAt.In(settings.Location(config.WorkingHours.Timezone))
	if settings.InQuietHours(local) {
		runAt = settings.QuietEnd(local)
	}
	_, err := jobs.NewQueue(tx).Enqueue(jobs.Enqueue{UserID: c.UserID, Kind: models.JobSendPush, DedupeKey: "push:" + n.ID, RunAt: runAt, Payload: models.JobPayload{"notificationId": n.ID}})
	return err
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
