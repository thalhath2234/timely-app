package learning

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
)

// Bot skills (plan 9b.3, PROTOCOL.md section 14): each Bot has its own skill,
// bot-<slug>, and a feedback review stages changes to it with the Bot's id.
// The Bots feature reads what a Bot was taught here, discards a deleted
// Bot's staged changes, and hears of each new staged change (a push).

// BotTaught is what a Bot was taught: its skill's "What you taught me"
// section (Found false when the skill is not made yet or cannot be read),
// and the changes staged for it, newest first.
type BotTaught struct {
	Found  bool
	Text   string
	Staged []Event
}

// taughtHeading starts the skill section the person's teaching is in.
const taughtHeading = "## What you taught me"

// botTaughtWait bounds reading a Bot's skill for its page: a worker that
// cannot start in time leaves the page with the seed.
const botTaughtWait = 10 * time.Second

// BotSkillName is a Bot's skill name for its slug.
func BotSkillName(slug string) string { return "bot-" + slug }

// SetBotStaged sets what runs when a change staged for a Bot is recorded
// (the bot_learned push). Nil does nothing.
func (s *Service) SetBotStaged(fn func(uid, botID, pendingID string)) {
	s.mu.Lock()
	s.botStaged = fn
	s.mu.Unlock()
}

func (s *Service) tellBotStaged(uid string, ev Event) {
	if ev.Status != StatusStaged || ev.BotID == "" || ev.PendingID == "" {
		return
	}
	s.mu.Lock()
	fn := s.botStaged
	s.mu.Unlock()
	if fn != nil {
		fn(uid, ev.BotID, ev.PendingID)
	}
}

// BotTaught reads what the account's Bot was taught. The staged changes come
// from Timely's own events; the text from the skill in the account's worker.
// An error is the skill's read; Staged is still filled.
func (s *Service) BotTaught(ctx context.Context, uid, botID, slug string) (BotTaught, error) {
	out := BotTaught{Staged: []Event{}}
	if err := s.db.WithContext(ctx).Where("user_id = ? AND bot_id = ? AND status = ?", uid, botID, StatusStaged).
		Order("created_at DESC, id DESC").Limit(50).Find(&out.Staged).Error; err != nil {
		return out, err
	}
	if slug == "" || s.workers == nil {
		return out, nil
	}
	ctx, cancel := context.WithTimeout(ctx, botTaughtWait)
	defer cancel()
	w, err := s.worker(ctx, uid)
	if err != nil {
		return out, err
	}
	release := w.Hold()
	defer release()
	data, err := askWorker(ctx, w, "learning.skill", map[string]any{"name": BotSkillName(slug)})
	var he *echo.HTTPError
	if errors.As(err, &he) && he.Code == http.StatusNotFound {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	var skill struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(data, &skill); err != nil {
		return out, err
	}
	out.Found, out.Text = true, TaughtSection(skill.Content)
	return out, nil
}

// TaughtSection is a Bot skill's "What you taught me" text: the lines after
// its heading up to the next heading of the same or a higher level, trimmed;
// "" when the skill has no such section, or holds "Nothing yet.".
func TaughtSection(content string) string {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	start := -1
	for i, l := range lines {
		if strings.EqualFold(strings.TrimSpace(l), taughtHeading) {
			start = i + 1
			break
		}
	}
	if start < 0 {
		return ""
	}
	end := len(lines)
	for i := start; i < len(lines); i++ {
		t := strings.TrimSpace(lines[i])
		if strings.HasPrefix(t, "# ") || strings.HasPrefix(t, "## ") {
			end = i
			break
		}
	}
	text := strings.TrimSpace(strings.Join(lines[start:end], "\n"))
	if text == "Nothing yet." {
		return ""
	}
	return text
}

// DiscardBot discards the changes still staged for a deleted Bot: each is
// marked discarded and thrown away in the worker (one it no longer holds
// just closes). It goes on past a failed one and returns the first error.
func (s *Service) DiscardBot(ctx context.Context, uid, botID string) error {
	var staged []Event
	if err := s.db.WithContext(ctx).Where("user_id = ? AND bot_id = ? AND status = ?", uid, botID, StatusStaged).
		Find(&staged).Error; err != nil || len(staged) == 0 {
		return err
	}
	var first error
	for _, ev := range staged {
		ok, err := s.claim(ctx, uid, ev.ID, []string{StatusStaged}, StatusDiscarded)
		if err != nil || !ok {
			first = errors.Join(first, err)
			continue
		}
		ev.Status = StatusDiscarded
		s.publishEvent(uid, ev)
	}
	if s.workers == nil {
		return first
	}
	w, err := s.worker(ctx, uid)
	if err != nil {
		return errors.Join(first, err)
	}
	release := w.Hold()
	defer release()
	for _, ev := range staged {
		rctx, cancel := context.WithTimeout(ctx, s.timeout)
		_, err := askWorker(rctx, w, "learning.pending", map[string]any{"pending_id": ev.PendingID, "choice": "discard"})
		cancel()
		var he *echo.HTTPError
		if err != nil && !(errors.As(err, &he) && he.Code == http.StatusNotFound) {
			first = errors.Join(first, err)
		}
	}
	return first
}
