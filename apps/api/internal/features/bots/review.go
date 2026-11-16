package bots

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/features/learning"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// Bot skills and feedback reviews (plan 9b.3, section 13 "Phase 7", ADR 0028;
// PROTOCOL.md section 14). Each Bot has its own skill, bot-<skill_slug>, which
// the agent worker makes on the Bot's first tick (writing the taught seed
// as its "What you taught me") and loads into every tick. A note, or Not
// useful, on one of its alerts queues a feedback review: the worker replays
// the tick from the Check's run record and may change only bot-<slug>, and
// every change is staged for the person to Keep or Discard.

// Reviewer runs a Bot's feedback review and deletes its skill, on the
// account's agent worker (chat.BotAgent). Tests use a fake.
type Reviewer interface {
	// Review sends one bot.review and waits for its learning.result.
	Review(ctx context.Context, userID string, in ReviewInput) (ReviewResult, error)
	// Forget sends bot.forget: the Bot skill bot-<slug> is deleted.
	Forget(ctx context.Context, userID, slug string) error
}

// ReviewInput is one bot.review (PROTOCOL.md 14.2).
type ReviewInput struct {
	BotID, BotName, SkillSlug, CheckID, Prompt string
	// Messages are the tick's messages from its run record; may be empty.
	Messages []json.RawMessage
	// Focus is the person's note, or the Not useful reason without one.
	Focus string
	// Feedback is FeedbackUseful or FeedbackNotUseful.
	Feedback string
	Model    ModelChoice
}

// ReviewResult is what a review staged.
type ReviewResult struct {
	PendingIDs []string
}

// Teacher reads what a Bot was taught (the learning feature): the "What you
// taught me" text of its skill and the staged changes suggested for it.
type Teacher interface {
	BotTaught(ctx context.Context, userID, botID, slug string) (learning.BotTaught, error)
	// DiscardBot discards the changes still staged for a deleted Bot.
	DiscardBot(ctx context.Context, userID, botID string) error
}

// Taught is a Bot page's "What this bot was taught" (contract BotTaught).
type Taught struct {
	// Text is the skill's "What you taught me" text; before the skill is made,
	// the taught seed that will become it.
	Text string `json:"text"`
	// Staged are the changes feedback reviews suggested, waiting for Keep or
	// Discard, newest first.
	Staged []learning.Event `json:"staged"`
}

// SetReviewer gives Bots their feedback reviews and skill deletes (nil: a
// rating queues a review that does nothing, and Delete leaves the skill).
func (s *Service) SetReviewer(r Reviewer) { s.reviewer = r }

// SetTeacher gives the Bot page its "What this bot was taught" from the
// learning feature (nil: the taught seed only).
func (s *Service) SetTeacher(t Teacher) { s.teacher = t }

// Taught is what the Bot was taught, for its page. It never fails: without
// the learning feature or the worker it is the taught seed and no staged
// changes.
func (s *Service) Taught(ctx context.Context, userID, botID string) Taught {
	out := Taught{Staged: []learning.Event{}}
	var b Bot
	if err := s.db.WithContext(ctx).Select("id", "skill_slug", "taught_seed").Where("id = ? AND user_id = ?", botID, userID).Take(&b).Error; err != nil {
		return out
	}
	out.Text = b.TaughtSeed
	if s.teacher == nil {
		return out
	}
	t, err := s.teacher.BotTaught(ctx, userID, b.ID, b.SkillSlug)
	if err != nil {
		log.Printf("bots: what %s was taught: %v", b.ID, err)
	}
	if t.Staged != nil {
		out.Staged = t.Staged
	}
	if t.Found {
		// The skill exists: its text is what the Bot was taught (a seed not
		// yet cleared is already in it).
		out.Text = t.Text
	}
	return out
}

// The feedback review job: one per rated alert at a time, a few tries.
const (
	reviewAttempts = 3
	// reviewKeep is how many of a Bot's newest alerted Checks keep their run's
	// messages for a review; older ones, and Checks without an alert, drop
	// them at the Bot's next tick.
	reviewKeep = 20
)

func reviewKey(alertID string) string { return "bot_review:" + alertID }

// reviewWanted reports whether an alert's rating starts a feedback review
// (Q2): a note, or Not useful (its reason is the focus). A plain Useful only
// records feedback.
func reviewWanted(a Alert) bool {
	if a.Feedback == nil {
		return false
	}
	return *a.Feedback == FeedbackNotUseful || strings.TrimSpace(a.FeedbackNote) != ""
}

// reasonWords are the Not useful reasons as the person's words.
var reasonWords = map[string]string{
	"too_small":        "Too small to tell me about",
	"not_wanted":       "Not what I want",
	"already_knew":     "I already knew",
	PassFeedbackReason: "Not worth passing on",
}

// reviewFocus is the review's focus: the person's note, with the Not useful
// reason before it; the reason alone without a note.
func reviewFocus(a Alert) string {
	note := strings.TrimSpace(a.FeedbackNote)
	if a.Feedback == nil || *a.Feedback != FeedbackNotUseful {
		return note
	}
	why := reasonWords[a.FeedbackReason]
	if why == "" {
		why = "Not useful"
	}
	if note == "" {
		return why
	}
	return why + ". " + note
}

// queueReview queues the feedback review of a rated alert in the rating's
// transaction.
func queueReview(tx *gorm.DB, a Alert, now time.Time) error {
	_, err := jobs.NewQueue(tx).Enqueue(jobs.Enqueue{
		UserID: a.UserID, Kind: models.JobBotReview, DedupeKey: reviewKey(a.ID), MaxAttempts: reviewAttempts, RunAt: now,
		Payload: models.JobPayload{"botId": a.BotID, "alertId": a.ID},
	})
	return err
}

// HandleReview runs one feedback review (job bot_review): the alert's rating
// as it is now (taken back or made a plain Useful since: nothing to do), the
// Bot's prompt, skill and model, and its Check's messages.
func (s *Service) HandleReview(ctx context.Context, job *models.Job) error {
	if s.reviewer == nil {
		return nil
	}
	db := s.db.WithContext(ctx)
	var alerts []Alert
	if err := db.Where("id = ? AND user_id = ?", job.Payload.String("alertId"), job.UserID).Limit(1).Find(&alerts).Error; err != nil {
		return err
	}
	if len(alerts) == 0 || !reviewWanted(alerts[0]) {
		return nil
	}
	a := alerts[0]
	var bots []Bot
	if err := db.Where("id = ? AND user_id = ?", a.BotID, job.UserID).Limit(1).Find(&bots).Error; err != nil {
		return err
	}
	if len(bots) == 0 {
		return nil
	}
	b := bots[0]
	slug, err := EnsureSkillSlug(db, b.UserID, b.ID)
	if err != nil {
		return err
	}
	in := ReviewInput{
		BotID: b.ID, BotName: b.Name, SkillSlug: slug, Prompt: b.Prompt, Messages: []json.RawMessage{},
		Focus: reviewFocus(a), Feedback: *a.Feedback, Model: ModelChoice{Provider: b.ModelProvider, Model: b.Model},
	}
	if in.Prompt == "" {
		in.Prompt = b.Description
	}
	if a.CheckID != nil {
		in.CheckID = *a.CheckID
		var checks []Check
		if err := db.Select("id", "run").Where("id = ? AND user_id = ?", *a.CheckID, job.UserID).Limit(1).Find(&checks).Error; err != nil {
			return err
		}
		if len(checks) > 0 && checks[0].Run != nil && checks[0].Run.Messages != nil {
			in.Messages = checks[0].Run.Messages
		}
	}
	if in.CheckID == "" {
		in.CheckID = "alert_" + a.ID
	}
	_, err = s.reviewer.Review(ctx, b.UserID, in)
	if errors.Is(err, ErrNoAI) {
		return jobs.Permanent(err)
	}
	return err
}

// forgetPoll and forgetWait: how often, and how long, forget looks for the
// Bot's row to be gone before it deletes the skill (a delete in a chat's
// transaction commits after Delete returns, and a rehearsal never does).
var (
	forgetPoll = 2 * time.Second
	forgetWait = time.Minute
)

// forget discards a deleted Bot's staged changes and deletes its skill, in
// the background: the worker may need starting. It waits until the Bot's
// row is gone for good, so a delete rolled back keeps both.
func (s *Service) forget(userID, botID, slug string) {
	if (s.reviewer == nil && s.teacher == nil) || s.bg == nil {
		return
	}
	root := s.root
	if root == nil {
		root = s.db
	}
	s.bg.Add(1)
	go func() {
		defer s.bg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), forgetWait+2*time.Minute)
		defer cancel()
		for waited := time.Duration(0); ; waited += forgetPoll {
			var n int64
			if err := root.WithContext(ctx).Model(&Bot{}).Where("id = ? AND user_id = ?", botID, userID).Count(&n).Error; err != nil {
				log.Printf("bots: forgetting deleted bot %s: %v", botID, err)
				return
			}
			if n == 0 {
				break
			}
			if waited >= forgetWait {
				return // not deleted after all
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(forgetPoll):
			}
		}
		if s.teacher != nil {
			if err := s.teacher.DiscardBot(ctx, userID, botID); err != nil {
				log.Printf("bots: discarding what deleted bot %s learned: %v", botID, err)
			}
		}
		if s.reviewer != nil && slug != "" {
			if err := s.reviewer.Forget(ctx, userID, slug); err != nil {
				log.Printf("bots: deleting the skill of deleted bot %s: %v", botID, err)
			}
		}
	}()
}

// Wait waits for the background skill deletes of deleted Bots (tests,
// shutdown).
func (s *Service) Wait() {
	if s.bg != nil {
		s.bg.Wait()
	}
}

// taughtLines are what a judge or brief reads as the person's teaching: the
// Bot's taught seed (its old lessons, one per line), newest first, at most n.
// A Bot whose skill holds them already reads none (the rules code that reads
// them goes in phase 8).
func taughtLines(b Bot, n int) []string {
	var out []string
	lines := strings.Split(b.TaughtSeed, "\n")
	for i := len(lines) - 1; i >= 0 && len(out) < n; i-- {
		if l := strings.TrimSpace(lines[i]); l != "" {
			out = append(out, l)
		}
	}
	return out
}

// afterTickRecord runs in a tick's save, after its Check is written: a tick
// that made the Bot's skill wrote the taught seed into it, so the seed is
// cleared; and older Checks drop their run's messages, kept only for the
// Bot's recent alerts (they hold outside content).
func afterTickRecord(tx *gorm.DB, b Bot, checkID string, res AgentResult) error {
	if res.SkillCreated && b.TaughtSeed != "" {
		if err := tx.Model(&Bot{}).Where("id = ? AND user_id = ? AND taught_seed = ?", b.ID, b.UserID, b.TaughtSeed).
			UpdateColumn("taught_seed", "").Error; err != nil {
			return err
		}
	}
	return pruneRunMessages(tx, b.ID, checkID)
}

// pruneRunMessages drops the messages of the Bot's Checks other than keep,
// except the reviewKeep newest that raised an alert.
func pruneRunMessages(tx *gorm.DB, botID, keep string) error {
	return tx.Exec(`
UPDATE bot_checks SET run = run - 'messages'
WHERE bot_id = @bot AND id <> @keep AND run IS NOT NULL AND run->'messages' IS NOT NULL
  AND (alert_id IS NULL OR id NOT IN (
      SELECT id FROM bot_checks WHERE bot_id = @bot AND alert_id IS NOT NULL AND run->'messages' IS NOT NULL
      ORDER BY started_at DESC, id DESC LIMIT @n))`,
		map[string]any{"bot": botID, "keep": keep, "n": reviewKeep}).Error
}

// publicRun is a run record as views show it: without the messages.
func publicRun(r *RunRecord) *RunRecord {
	if r == nil || r.Messages == nil {
		return r
	}
	c := *r
	c.Messages = nil
	return &c
}

// MaxSkillSlug bounds a skill slug (PROTOCOL.md 14.1: 1 to 60 characters).
const MaxSkillSlug = 60

var (
	slugJunk  = regexp.MustCompile(`[^a-z0-9]+`)
	slugShape = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$`)
)

// ValidSkillSlug reports a slug the worker accepts.
func ValidSkillSlug(slug string) bool { return slugShape.MatchString(slug) }

// slugBase is a Bot name as a slug: lowercase letters and digits, every
// other run of characters one dash, at most 50 characters (room for a
// number), "bot" when nothing is left.
func slugBase(name string) string {
	s := strings.Trim(slugJunk.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(s) > MaxSkillSlug-10 {
		s = strings.TrimRight(s[:MaxSkillSlug-10], "-")
	}
	if s == "" {
		s = "bot"
	}
	return s
}

// newSkillSlug is a slug for name not yet used in the account: the name's,
// with -2, -3, ... appended on a clash.
func newSkillSlug(tx *gorm.DB, userID, name string) (string, error) {
	var used []string
	if err := tx.Model(&Bot{}).Where("user_id = ? AND skill_slug <> ''", userID).Pluck("skill_slug", &used).Error; err != nil {
		return "", err
	}
	taken := make(map[string]bool, len(used))
	for _, u := range used {
		taken[u] = true
	}
	base := slugBase(name)
	slug := base
	for n := 2; taken[slug]; n++ {
		slug = base + "-" + strconv.Itoa(n)
	}
	return slug, nil
}

// EnsureSkillSlug is the Bot's skill slug, made from its name and saved the
// first time (the account's Bots are locked meanwhile, so two Bots never
// take the same one). Never changed after.
func EnsureSkillSlug(db *gorm.DB, userID, botID string) (string, error) {
	var slug string
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := lockAccount(tx, userID); err != nil {
			return err
		}
		var b Bot
		if err := tx.Select("id", "name", "skill_slug").Where("id = ? AND user_id = ?", botID, userID).Take(&b).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		if b.SkillSlug != "" {
			slug = b.SkillSlug
			return nil
		}
		next, err := newSkillSlug(tx, userID, b.Name)
		if err != nil {
			return err
		}
		slug = next
		return tx.Model(&Bot{}).Where("id = ? AND user_id = ? AND skill_slug = ''", botID, userID).UpdateColumn("skill_slug", slug).Error
	})
	return slug, err
}
