package chat

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"time"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/sheet"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/realtime"
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
	estimates  func(ctx context.Context, userID string, names, descriptions []string) []int
	live       *realtime.Hub
	botNames   func(ctx context.Context, userID string) ([]BotName, error)
	engine     AgentEngine
	// stopLearning tells the worker a chat no longer learns, or with
	// searchOnly no longer searches past chats (SetStopLearning).
	stopLearning func(uid, cid string, searchOnly bool)
	wg           sync.WaitGroup
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
	g.GET("/chats/watch", s.watch)
	g.POST("/chats", s.create)
	g.GET("/chats/:id", s.get)
	g.POST("/chats/:id/messages", s.send)
	g.POST("/chats/:id/approve", s.approve)
	g.POST("/chats/:id/reject", s.reject)
	g.POST("/chats/:id/steps/discard", s.discardSteps)
	g.DELETE("/chats/:id", s.remove)
	g.POST("/chats/:id/stop", s.stop)
	g.POST("/chats/:id/retry", s.retry)
	g.POST("/chats/:id/read", s.read)
	g.PATCH("/chats/:id", s.configure)
	g.POST("/chats/:id/similar", s.similar)
	g.POST("/chats/:id/steer", s.steer)
	g.POST("/chats/:id/undo", s.undo)
	g.GET("/agent/chat-settings", s.getChatSettings)
	g.PATCH("/agent/chat-settings", s.patchChatSettings)
	g.GET("/agent/tool-specs", s.toolSpecs)
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
	err := s.db.Select("id", "title", "status", "phase", "web_search", "no_learning", "revision", "unread", "error", "permission", "engine", "run_engine", "created_at", "updated_at").Where("user_id = ?", user(c)).Order("updated_at DESC").Limit(200).Find(&rows).Error
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
	// Client is the app that sent the message: "phone" or "web" (anything
	// else is the web). The agent's saved-view tools act on that app's views.
	Client string `json:"client"`
	// UI is "openui-1" from apps that draw reply cards; the agent may then
	// add them to its replies.
	UI string `json:"ui"`
	// Provider and Model pick the model for a new conversation; empty follows
	// the account default.
	Provider string `json:"provider"`
	Model    string `json:"model"`
	// Receipt is the receipt review form as the person left it, sent with a
	// message typed during the review so unsaved edits are revised, not lost.
	Receipt *ReceiptDraft `json:"receipt"`
	// BotTags are the Bots (ids) the apps' @ picker tagged in this message,
	// for this message only. Typed tags are found in Content as well
	// (bot_tags.go).
	BotTags []string `json:"botTags"`
	// Permission is the new chat's permission mode; empty takes the
	// account's default for new chats (POST /chats only).
	Permission string `json:"permission"`
}

// ProviderIDs is implemented by Completers that can tell a provider id they
// serve from a typo; a choice they don't know is refused when it is made
// instead of failing the run later.
type ProviderIDs interface {
	KnownProvider(id string) bool
}

// pickProvider is the provider id of a model picked in the chat menu, lower
// case ("Anthropic" is "anthropic"); an id the server has no provider for
// is refused. Whether the provider is connected is checked when a run
// starts, like the default.
func (s *Service) pickProvider(provider string) (string, error) {
	provider = strings.ToLower(provider)
	if known, ok := s.completers.(ProviderIDs); ok && provider != "" && !known.KnownProvider(provider) {
		return "", echo.NewHTTPError(400, fmt.Sprintf("Unknown AI provider %q. Pick one in the chat's model menu", provider))
	}
	return provider, nil
}

// cleanInput drops NUL characters, which Postgres can't store: a message
// with one failed with HTTP 500.
func cleanInput(in *sendInput) {
	in.Content = dropNUL(in.Content)
	in.Context = cleanChips(in.Context)
}

func cleanChips(chips []ContextChip) []ContextChip {
	for i := range chips {
		chips[i] = ContextChip{Kind: dropNUL(chips[i].Kind), Label: dropNUL(chips[i].Label), Value: dropNUL(chips[i].Value)}
	}
	return chips
}

// validChoice checks the shape of a model picked in the chat menu.
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
		// Counted in characters, as the apps clip them: a chip of Japanese
		// text is three bytes a character.
		if utf8.RuneCountInString(c.Value) > 12000 || utf8.RuneCountInString(c.Label) > 200 || len(c.Kind) > 30 {
			return echo.NewHTTPError(400, "Context attachment is too large")
		}
	}
	if in.Receipt != nil && len(in.Receipt.Items) > 300 {
		return echo.NewHTTPError(400, "A receipt can contain at most 300 items")
	}
	if len(in.BotTags) > maxBotTags {
		return echo.NewHTTPError(400, fmt.Sprintf("Tag up to %d bots", maxBotTags))
	}
	for _, tag := range in.BotTags {
		if len(tag) > 100 {
			return echo.NewHTTPError(400, "Invalid bot tag")
		}
	}
	return nil
}
func (s *Service) create(c *echo.Context) error {
	var in sendInput
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid message")
	}
	cleanInput(&in)
	if err := validateInput(in); err != nil {
		return err
	}
	provider, err := s.pickProvider(in.Provider)
	if err != nil {
		return err
	}
	in.Provider = provider
	permission, err := s.newChatPermission(user(c), in.Permission)
	if err != nil {
		return err
	}
	if in.Context == nil {
		in.Context = []ContextChip{}
	}
	if strings.TrimSpace(in.Content) == "" {
		in.Content = "Process these images"
	}
	tags, err := s.messageTags(c.Request().Context(), user(c), in)
	if err != nil {
		return err
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
	firstMessage.BotTags = tags
	row := Conversation{ID: cid, UserID: user(c), Title: string(title), Status: "queued", Phase: "plan", WebSearch: in.WebSearch, ChosenProvider: in.Provider, ChosenModel: in.Model, Timezone: validTimezone(in.Timezone), Client: agent.NormalizeClient(in.Client), RichUI: in.UI == genuiCapability, Permission: permission, Context: in.Context, Messages: []Message{firstMessage}, Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
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
	return s.save(c, func(tx *gorm.DB, row *Conversation) error {
		if err := fn(tx, row); err != nil {
			return err
		}
		row.Revision++
		return nil
	})
}

func (s *Service) save(c *echo.Context, fn func(*gorm.DB, *Conversation) error) error {
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
	cleanInput(&in)
	if err := validateInput(in); err != nil {
		return err
	}
	tags, err := s.messageTags(c.Request().Context(), user(c), in)
	if err != nil {
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
		row.Client = agent.NormalizeClient(in.Client)
		row.RichUI = in.UI == genuiCapability
		noteLanguage(row, in.Content)
		row.ForceReview = row.Status == "approval" || row.Sensitive
		archivePlan(row)
		nextMessage := message("user", in.Content)
		nextMessage.RequestID = in.RequestID
		nextMessage.BotTags = tags
		row.Messages = append(row.Messages, nextMessage)
		row.Status = "queued"
		row.Phase = "plan"
		if len(in.ImageIDs) == 0 && row.ImageReview != nil && row.ImageReview.Status == "extracting" {
			row.Phase = "extract"
		} else if len(in.ImageIDs) == 0 && row.ImageReview != nil && row.ImageReview.Receipt != nil && row.ImageReview.Status == "review" {
			row.Phase = "receipt_edit"
			if in.Receipt != nil {
				// The person's unsaved form edits are the draft to revise.
				draft := *in.Receipt
				normalizeReceipt(&draft)
				row.ImageReview.Receipt = &draft
			}
		}
		row.Error = ""
		row.Unread = false
		return attachImages(tx, row, in.ImageIDs)
	})
}

// approve applies the proposal. With steps (plan indexes, as the review
// groups them), only those changes and the earlier changes they build on are
// applied now; the rest stay for review.
func (s *Service) approve(c *echo.Context) error {
	var in struct {
		Revision int   `json:"revision"`
		Steps    []int `json:"steps"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid approval")
	}
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if row.Status != "approval" || row.Revision != in.Revision {
			return echo.NewHTTPError(409, "This proposal changed. Review the latest version before applying")
		}
		receipt := row.ImageReview != nil && row.ImageReview.Status != "discarded"
		if len(in.Steps) > 0 && receipt {
			return echo.NewHTTPError(409, "A receipt is saved as a whole. Apply all of its changes or discard them")
		}
		for i := range row.Plan {
			if row.Plan[i].Status == stepApproved {
				row.Plan[i].Status = "pending"
			}
		}
		if len(in.Steps) > 0 {
			chosen, err := planSelection(row.Plan, in.Steps)
			if err != nil {
				return err
			}
			for _, i := range withDependencies(row.Plan, chosen) {
				if row.Plan[i].Status != "done" && row.Plan[i].Status != "discarded" {
					row.Plan[i].Status = stepApproved
				}
			}
		}
		if len(row.Plan) > 0 && !hasPending(row.Plan) {
			return echo.NewHTTPError(409, "Every change here is applied or discarded")
		}
		if receipt && row.ImageReview.Status != "confirmed" {
			// Said once, when the receipt is confirmed: approving again after
			// a failed apply, or a later proposal in the same chat, adds no
			// second confirmation.
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
	runID := ""
	err := s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if busy(row) || row.Status == "approval" {
			row.Status = "stopped"
			row.Lease = ""
			row.LeaseUntil = nil
			// The agent run ends once this commits (engine Stop below).
			runID, row.AgentRunID, row.AgentInstance = row.AgentRunID, "", ""
			// What it streamed stays as the reply (Q-2.5): the engine's
			// copy when it follows the run, else the row's, which lags.
			draft := row.Activity.Draft
			if dr, ok := s.engine.(draftReader); ok && runID != "" {
				if live := dr.Draft(user(c), row.ID, runID); len(live) > len(draft) {
					draft = live
				}
			}
			row.Activity = ChatActivity{}
			from := len(row.Messages)
			if text := strings.TrimSpace(draft); text != "" {
				m := message("assistant", text)
				m.Cut = true
				row.Messages = append(row.Messages, m)
			}
			row.Messages = append(row.Messages, notice(tr(row.Language, txtStopped)))
			// The cut reply and the notice belong to the stopped run, so what
			// it learned shows under them, not under a later reply.
			markStopped(row, from, runID)
		}
		return nil
	})
	if err == nil && runID != "" && s.engine != nil {
		s.engine.Stop(user(c), c.Param("id"), runID)
	}
	return err
}

// discardSteps sets changes of a proposal aside before applying it (keep
// false), or brings them back (keep true). A change built on a discarded one
// ("$2.task.id") is set aside with it, and one brought back brings back what
// it builds on. When nothing is left to apply, the proposal ends: as applied
// when part of it was, else as discarded.
func (s *Service) discardSteps(c *echo.Context) error {
	var in struct {
		Revision int   `json:"revision"`
		Steps    []int `json:"steps"`
		Keep     bool  `json:"keep"`
	}
	if err := c.Bind(&in); err != nil || len(in.Steps) == 0 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if row.Status != "approval" {
			return echo.NewHTTPError(409, "There is no proposal waiting for approval")
		}
		if row.Revision != in.Revision {
			return echo.NewHTTPError(409, "This proposal changed. Review the latest version first")
		}
		if row.ImageReview != nil && row.ImageReview.Status != "discarded" {
			return echo.NewHTTPError(409, "A receipt is saved as a whole. Apply all of its changes or discard them")
		}
		chosen, err := planSelection(row.Plan, in.Steps)
		if err != nil {
			return err
		}
		if in.Keep {
			for _, i := range withDependencies(row.Plan, chosen) {
				if row.Plan[i].Status == "discarded" {
					row.Plan[i].Status = "pending"
				}
			}
			return nil
		}
		for _, i := range withDependents(row.Plan, chosen) {
			if row.Plan[i].Status == "pending" || row.Plan[i].Status == stepApproved {
				row.Plan[i].Status = "discarded"
			}
		}
		if hasPending(row.Plan) {
			return nil
		}
		row.Phase = "plan"
		row.Error = ""
		row.Unread = false
		row.Status = "idle"
		for _, step := range row.Plan {
			if step.Status == "done" {
				row.Messages = append(row.Messages, notice(tr(row.Language, txtDone)))
				return nil
			}
		}
		archivePlanAs(row, tr(row.Language, txtDiscardedChanges), "discarded")
		row.Messages = append(row.Messages, notice(tr(row.Language, txtDiscarded)))
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
		if slices.ContainsFunc(row.Plan, func(step Step) bool { return step.Status == "done" }) {
			// Some cards were applied one by one: those stay, the rest is set
			// aside, and the plan stays on screen as a finished one would.
			for i := range row.Plan {
				if row.Plan[i].Status != "done" {
					row.Plan[i].Status = "discarded"
				}
			}
			row.Status = "idle"
			row.Phase = "plan"
			row.Error = ""
			row.Unread = false
			row.Messages = append(row.Messages, notice(tr(row.Language, txtDone)))
			return nil
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
	runID := ""
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {
			return err
		}
		runID = row.AgentRunID
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
	if s.engine != nil {
		// The row is gone: end its live run and drop its worker session.
		if runID != "" {
			s.engine.Stop(user(c), c.Param("id"), runID)
		}
		s.engine.Forget(user(c), c.Param("id"))
	}
	return c.NoContent(204)
}
func (s *Service) retry(c *echo.Context) error {
	// The app that retries says where it is, as a new message does: a run
	// retried on the computer after the phone left off uses the computer's
	// zone and views.
	var in struct {
		Timezone string `json:"timezone"`
		Client   string `json:"client"`
		UI       string `json:"ui"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		if row.Status != "failed" && row.Status != "stopped" {
			return echo.NewHTTPError(409, "This run cannot be retried")
		}
		if in.Client != "" {
			if zone := validTimezone(in.Timezone); zone != "" {
				row.Timezone = zone
			}
			row.Client = agent.NormalizeClient(in.Client)
			row.RichUI = in.UI == genuiCapability
		}
		row.Error = ""
		row.Unread = false
		// A retried run starts afresh; an agent run it had is over.
		row.AgentRunID, row.AgentInstance = "", ""
		if row.Phase == "apply" && len(row.Plan) > 0 && !hasPending(row.Plan) {
			// Stopped after the last change was saved: finish the apply, which
			// continues with the next batch or says the request is done.
			row.Status = "queued"
		} else if row.Phase == "apply" && len(row.Plan) > 0 {
			row.Status = "approval"
			for i := range row.Plan {
				if row.Plan[i].Status != "done" && row.Plan[i].Status != "discarded" {
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

// Omitted fields are left unchanged. Renaming is allowed at any time; context,
// web search and the engine wait for the current run, which already read
// them; the permission mode may change at any time. A model
// choice may change at any time and applies from the next run; provider and
// model are set together, and an empty provider returns to the default.
func (s *Service) configure(c *echo.Context) error {
	var in struct {
		Title     *string        `json:"title"`
		WebSearch *bool          `json:"webSearch"`
		Context   *[]ContextChip `json:"context"`
		Provider  *string        `json:"provider"`
		Model     *string        `json:"model"`
		// Permission and Engine are the chat's own permission mode and
		// engine ("" follows the account).
		Permission *string `json:"permission"`
		Engine     *string `json:"engine"`
		// NoLearning is "Don't learn from this chat"; it applies from the
		// chat's next run.
		NoLearning *bool `json:"noLearning"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid settings")
	}
	if in.Permission != nil {
		mode, err := agent.ParseMode(*in.Permission)
		if err != nil {
			return echo.NewHTTPError(400, "Permission must be supervised, auto or full")
		}
		*in.Permission = string(mode)
	}
	if in.Engine != nil && *in.Engine != "" && *in.Engine != engineClassic && *in.Engine != engineAgent {
		return echo.NewHTTPError(400, "Engine must be classic, agent or empty")
	}
	if in.Provider != nil {
		model := ""
		if in.Model != nil {
			model = *in.Model
		}
		if err := validChoice(*in.Provider, model); err != nil {
			return err
		}
		provider, err := s.pickProvider(*in.Provider)
		if err != nil {
			return err
		}
		in.Provider = &provider
	} else if in.Model != nil {
		return echo.NewHTTPError(400, "Choose a provider for this model")
	}
	if in.Context != nil {
		*in.Context = cleanChips(*in.Context)
		if err := validateInput(sendInput{Content: "context", Context: *in.Context}); err != nil {
			return err
		}
	}
	title := ""
	if in.Title != nil {
		title = strings.TrimSpace(dropNUL(*in.Title))
		if title == "" || len([]rune(title)) > 120 {
			return echo.NewHTTPError(400, "Title must be between 1 and 120 characters")
		}
	}
	err := s.save(c, func(tx *gorm.DB, row *Conversation) error {
		if (in.Context != nil || in.WebSearch != nil) && busy(row) {
			return echo.NewHTTPError(409, "Wait or stop before changing context")
		}
		if in.Engine != nil && *in.Engine != row.Engine && busy(row) {
			return echo.NewHTTPError(409, "Wait or stop before changing the engine")
		}
		if in.Engine != nil {
			row.Engine = *in.Engine
		}
		if in.Permission != nil {
			// Any time: a looser mode approves nothing already waiting, and
			// the next proposal reads the new mode (permission_mode.go).
			row.Permission = *in.Permission
		}
		if in.Title != nil {
			row.Title = title
		}
		if in.NoLearning != nil {
			row.NoLearning = *in.NoLearning
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
	if err == nil && in.NoLearning != nil && *in.NoLearning && s.stopLearning != nil {
		// A run or learning pass of this chat still going writes nothing
		// more ("Timely won't learn from this chat").
		uid, cid := user(c), c.Param("id")
		go s.stopLearning(uid, cid, false)
	}
	return err
}

// SetStopLearning lets "Don't learn from this chat" stop a run or learning
// pass of the chat that is still going (learning.Service.StopLearning).
func (s *Service) SetStopLearning(fn func(uid, cid string, searchOnly bool)) { s.stopLearning = fn }

// newChatPermission is a new chat's permission mode: the one asked for,
// else the account's default for new chats.
func (s *Service) newChatPermission(uid, asked string) (string, error) {
	if asked != "" {
		mode, err := agent.ParseMode(asked)
		if err != nil {
			return "", echo.NewHTTPError(400, "Permission must be supervised, auto or full")
		}
		return string(mode), nil
	}
	prefs, err := chatSettings(s.db, uid)
	if err != nil {
		// Without saved settings (or their table), new chats are Supervised.
		return string(agent.Supervised), nil
	}
	return prefs.ChatPermission, nil
}

// steer passes a message the person types while an agent run is live into
// that run (plan 3.4); it is stored as a user message of kind "steer".
func (s *Service) steer(c *echo.Context) error {
	var in struct {
		Text string `json:"text"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid message")
	}
	in.Text = strings.TrimSpace(dropNUL(in.Text))
	if in.Text == "" || utf8.RuneCountInString(in.Text) > 16000 {
		return echo.NewHTTPError(400, "Message must be between 1 and 16,000 characters")
	}
	if s.engine == nil {
		return echo.NewHTTPError(409, "Nothing is running in this chat")
	}
	var row Conversation
	runID := ""
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {
			return err
		}
		if row.Status != "running" || row.AgentRunID == "" {
			return echo.NewHTTPError(409, "Nothing is running in this chat")
		}
		runID = row.AgentRunID
		m := message("user", in.Text)
		m.Kind = "steer"
		row.Messages = append(row.Messages, m)
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil {
		return err
	}
	if err := s.engine.Steer(c.Request().Context(), row.UserID, row.ID, runID, in.Text); err != nil {
		// No run read it: take it back, so the person can send it again
		// as a new message.
		steerID := row.Messages[len(row.Messages)-1].ID
		if derr := s.db.Transaction(func(tx *gorm.DB) error {
			var latest Conversation
			if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), row.UserID, row.ID, &latest); err != nil {
				return err
			}
			kept := latest.Messages[:0]
			for _, m := range latest.Messages {
				if m.ID != steerID {
					kept = append(kept, m)
				}
			}
			latest.Messages = kept
			latest.Revision++
			return tx.Save(&latest).Error
		}); derr != nil {
			log.Printf("chat steer: taking back an undelivered steer: %v", derr)
		}
		return echo.NewHTTPError(409, "The run ended before your message reached it")
	}
	s.fillImages(&row)
	return c.JSON(200, row)
}

// leftoverSteer makes the steering messages a finished run never read (sent
// while its last reply streamed, Hermes' pending_steer) the person's next
// turn: they move to the end as ordinary messages. An idle chat runs them;
// a held proposal gives way to them, as it does to a new message (send); an
// Auto proposal still applying runs them once it is applied (apply). text
// is the newline join of those messages; text that matches none of the
// run's steers is left alone.
func (s *Service) leftoverSteer(ctx context.Context, uid, cid, text string) error {
	text = strings.TrimSpace(text)
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		steers := runSteers(row.Messages, text)
		if steers == nil {
			return nil
		}
		if row.Status == "approval" {
			row.ForceReview = true
			archivePlan(&row)
			row.Phase = "plan"
			row.Status = "queued"
		}
		moved := make([]Message, 0, len(steers))
		kept := make([]Message, 0, len(row.Messages))
		next := 0
		for i, m := range row.Messages {
			if next < len(steers) && steers[next] == i {
				m.Kind = ""
				moved = append(moved, m)
				next++
				continue
			}
			kept = append(kept, m)
		}
		row.Messages = append(kept, moved...)
		if row.Status == "idle" {
			row.Status = "queued"
			row.Phase = "plan"
			row.Error = ""
		}
		row.Revision++
		return tx.Save(&row).Error
	})
}

// runSteers finds, among the steers of the run that just ended (between its
// request and its reply), the consecutive ones whose newline join is text.
// A message sent after the reply, or a later steer the run never took, does
// not get in the way.
func runSteers(messages []Message, text string) []int {
	end := len(messages)
	for i := len(messages) - 1; i >= 0; i-- {
		if m := messages[i]; m.Role == "assistant" && m.Kind == "" && !m.Cut {
			end = i
			break
		}
	}
	var candidates []int
	for i := end - 1; i >= 0; i-- {
		m := messages[i]
		if m.Role == "user" && m.Kind == "" {
			break // the run's own request: older steers belong to earlier runs
		}
		if m.Kind == "steer" {
			candidates = append([]int{i}, candidates...)
		}
	}
	for to := len(candidates); to > 0; to-- {
		for from := to - 1; from >= 0; from-- {
			parts := make([]string, 0, to-from)
			for _, k := range candidates[from:to] {
				parts = append(parts, messages[k].Content)
			}
			if strings.TrimSpace(strings.Join(parts, "\n")) == text {
				return candidates[from:to]
			}
		}
	}
	return nil
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

// AgentStateRestored marks every chat of the account for a reseed: a
// restore replaced the agent home, whose state.db now holds the backup's
// transcripts and not the turns since (chats are not in a backup), so each
// chat's next agent run sends its own messages with reseed. It is kept in
// Postgres, so an API restart before that run keeps it.
func (s *Service) AgentStateRestored(ctx context.Context, uid string) error {
	return s.db.WithContext(ctx).Model(&Conversation{}).Where("user_id = ?", uid).UpdateColumn("agent_reseed", true).Error
}

// keepTaint adds outside sources to a chat whatever its status or lease:
// tainted_sources only grows, so no fence guards it.
func (s *Service) keepTaint(ctx context.Context, uid, cid string, sources []TaintSource) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var latest Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &latest); err != nil {
			return err
		}
		known := len(latest.TaintedSources)
		mergeTaint(&latest, sources)
		if len(latest.TaintedSources) == known {
			return nil
		}
		return tx.Model(&latest).Select("TaintedSources").Updates(&latest).Error
	})
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
