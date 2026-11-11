package learning

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func user(c *echo.Context) string { v, _ := c.Get("userID").(string); return v }

// Routes registers /agent/learning/* (contract 3 of the phase 3 work
// packages). Every route is the signed-in account's own.
func (s *Service) Routes(g *echo.Group) {
	g.GET("/agent/learning/settings", s.getSettings)
	g.PATCH("/agent/learning/settings", s.patchSettings)
	g.GET("/agent/learning/events", s.listEvents)
	g.POST("/agent/learning/events/:id/undo", s.undo)
	g.GET("/agent/learning/skills", s.listSkills)
	g.GET("/agent/learning/skills/:name", s.getSkill)
	g.PUT("/agent/learning/skills/:name", s.editSkill)
	g.POST("/agent/learning/skills/:name/state", s.skillState)
	g.GET("/agent/learning/memory", s.getMemory)
	g.POST("/agent/learning/memory", s.editMemory)
	g.GET("/agent/learning/pending", s.listPending)
	g.POST("/agent/learning/pending/:pendingId", s.decidePending)
	g.GET("/agent/learning/upstream", s.listUpstream)
	g.GET("/agent/learning/upstream/:name", s.compareUpstream)
	g.POST("/agent/learning/upstream/:name", s.chooseUpstream)
	g.GET("/agent/learning/export", s.export)
}

func signedIn(c *echo.Context) (string, error) {
	uid := user(c)
	if uid == "" {
		return "", echo.NewHTTPError(http.StatusUnauthorized, "Sign in first")
	}
	return uid, nil
}

func settingsView(row Settings) settingsJSON {
	return settingsJSON{Learning: row.Learning, SearchHistory: row.SearchHistory, UseCaseCopied: row.UseCaseCopiedAt != nil}
}

func (s *Service) getSettings(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	row, err := loadSettings(c.Request().Context(), s.db, uid)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, settingsView(row))
}

// patchSettings changes Learning and "Search my past chats". Turning
// learning on while the account's worker runs copies "What you use Timely
// for" into About you when that has not happened yet (Q-3.3); otherwise the
// worker's next start does it.
func (s *Service) patchSettings(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	var in struct {
		Learning      *bool `json:"learning"`
		SearchHistory *bool `json:"searchHistory"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid settings")
	}
	ctx := c.Request().Context()
	db := s.db.WithContext(ctx)
	if err := ensureRow(db, uid); err != nil {
		return err
	}
	set := map[string]any{"updated_at": time.Now()}
	if in.Learning != nil {
		set["learning"] = *in.Learning
	}
	if in.SearchHistory != nil {
		set["search_history"] = *in.SearchHistory
	}
	if err := db.Model(&Settings{}).Where("user_id = ?", uid).Updates(set).Error; err != nil {
		return err
	}
	if in.Learning != nil && *in.Learning && s.workers != nil {
		if w, ok := s.workers.Worker(uid); ok {
			release := w.Hold()
			copyCtx, cancel := context.WithTimeout(ctx, s.timeout)
			if err := s.copyUseCase(copyCtx, uid, w); err != nil {
				s.logf("learning: copying the use case into About you: %v", err)
			}
			cancel()
			release()
		}
	}
	if in.Learning != nil {
		// The worker's config renders curator.enabled from the switch: a
		// running worker hears it now, not at its next restart.
		s.pushSettings(ctx, uid)
	}
	if in.Learning != nil && !*in.Learning {
		// A run or learning pass still going writes nothing more.
		s.StopLearning(ctx, uid, "")
	}
	row, err := loadSettings(ctx, s.db, uid)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, settingsView(row))
}

var listableStatus = []string{StatusApplied, StatusStaged, StatusBlocked, StatusUndone, StatusKept, StatusDiscarded}

// listEvents is the account's learning feed, newest first:
// ?conversationId= (one chat's), &status=, &before=<RFC 3339 createdAt of
// the last event seen>, &limit= (50, at most 200).
func (s *Service) listEvents(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	q := s.db.WithContext(c.Request().Context()).Where("user_id = ?", uid)
	if conv := c.QueryParam("conversationId"); conv != "" {
		q = q.Where("conversation_id = ?", conv)
	}
	if status := c.QueryParam("status"); status != "" {
		if !slices.Contains(listableStatus, status) {
			return echo.NewHTTPError(http.StatusBadRequest, "Unknown status")
		}
		q = q.Where("status = ?", status)
	}
	if before := c.QueryParam("before"); before != "" {
		at, err := time.Parse(time.RFC3339Nano, before)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "before must be an RFC 3339 time")
		}
		q = q.Where("created_at < ?", at)
	}
	limit := 50
	if raw := c.QueryParam("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return echo.NewHTTPError(http.StatusBadRequest, "limit must be a positive number")
		}
		limit = min(n, 200)
	}
	events := []Event{}
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&events).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"events": events})
}

// claim moves the account's event from one of the statuses in from to
// status, and reports whether it did: two Undo clicks never both reach the
// worker.
func (s *Service) claim(ctx context.Context, uid, id string, from []string, status string) (bool, error) {
	res := s.db.WithContext(ctx).Model(&Event{}).Where("id = ? AND user_id = ? AND status IN ?", id, uid, from).
		Updates(map[string]any{"status": status, "updated_at": time.Now()})
	return res.RowsAffected == 1, res.Error
}

// unclaim puts a claimed event back when the worker could not do it.
func (s *Service) unclaim(uid, id, status string) {
	if err := s.db.Model(&Event{}).Where("id = ? AND user_id = ?", id, uid).
		Updates(map[string]any{"status": status, "updated_at": time.Now()}).Error; err != nil {
		s.logf("learning: putting event %s back to %s: %v", id, status, err)
	}
}

func (s *Service) find(ctx context.Context, uid, id string) (Event, error) {
	var ev Event
	err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, uid).Take(&ev).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ev, echo.NewHTTPError(http.StatusNotFound, "Not found")
	}
	return ev, err
}

// memoryUndo is the learning.memory request that puts an entry back to its
// before text: an added entry is removed, a removed one added back, a
// replaced one replaced back.
func memoryUndo(ev Event) (map[string]any, bool) {
	target := ev.Kind // "memory" or "user"
	switch {
	case ev.Before == "" && ev.After == "":
		return nil, false
	case ev.Before == "":
		return map[string]any{"target": target, "action": "remove", "content": "", "old": ev.After}, true
	case ev.After == "":
		return map[string]any{"target": target, "action": "add", "content": ev.Before, "old": ""}, true
	}
	return map[string]any{"target": target, "action": "replace", "content": ev.Before, "old": ev.After}, true
}

// undo takes back an applied (or kept) change: a skill change through its
// ledger entry (learning.rollback), a memory change by writing its before
// text back (learning.memory).
func (s *Service) undo(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	ctx := c.Request().Context()
	ev, err := s.find(ctx, uid, c.Param("id"))
	if err != nil {
		return err
	}
	if ev.Status != StatusApplied && ev.Status != StatusKept {
		return echo.NewHTTPError(http.StatusConflict, undoRefusal(ev.Status))
	}
	var typ string
	var fields map[string]any
	switch ev.Kind {
	case KindSkill:
		if ev.Action == "stale" {
			return echo.NewHTTPError(http.StatusConflict, "Timely only noted that this skill went unused; there is nothing to undo")
		}
		if ev.LedgerEntryID == "" {
			return echo.NewHTTPError(http.StatusConflict, "This change has no history entry to undo")
		}
		typ, fields = "learning.rollback", map[string]any{"ledger_entry_id": ev.LedgerEntryID}
	default:
		var ok bool
		if fields, ok = memoryUndo(ev); !ok {
			return echo.NewHTTPError(http.StatusConflict, "This change has nothing to undo")
		}
		typ = "learning.memory"
	}
	ok, err := s.claim(ctx, uid, ev.ID, []string{ev.Status}, StatusUndone)
	if err != nil {
		return err
	}
	if !ok {
		return echo.NewHTTPError(http.StatusConflict, "This change was just changed. Refresh and try again.")
	}
	data, err := s.ask(c, typ, fields)
	var he *echo.HTTPError
	if err != nil && ev.Kind != KindSkill && errors.As(err, &he) && he.Code == http.StatusNotFound {
		// The entry was changed or deleted since (in Settings, or by a
		// later chat): nothing is left to undo, and Undo must not stay.
		ev.Status = StatusUndone
		s.publishEvent(uid, ev)
		return echo.NewHTTPError(http.StatusConflict, "That entry was already changed or deleted, so there is nothing to undo")
	}
	if err != nil {
		s.unclaim(uid, ev.ID, ev.Status)
		return err
	}
	ev.Status = StatusUndone
	s.publishEvent(uid, ev)
	if ev.Kind == KindSkill {
		s.supersede(ctx, uid, ev)
		s.keepRestoredOff(ctx, uid, data)
	} else {
		s.supersedeMemory(ctx, uid, ev.Kind, ev.After, ev.ID)
	}
	return c.JSON(http.StatusOK, map[string]any{"event": ev, "result": data})
}

// keepRestoredOff turns off, and marks "restored, review", the skills an
// Undo of a history entry a backup brought back recreated (the worker's
// restored_skills, Q-3.4), and tells the worker.
func (s *Service) keepRestoredOff(ctx context.Context, uid string, data json.RawMessage) {
	var res struct {
		RestoredSkills []string `json:"restored_skills"`
	}
	if json.Unmarshal(data, &res) != nil || len(res.RestoredSkills) == 0 {
		return
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return MarkRestored(tx, uid, res.RestoredSkills)
	}); err != nil {
		s.logf("learning: keeping restored skills off after an Undo: %v", err)
		return
	}
	s.pushSettings(ctx, uid)
}

// supersede marks the later changes to the same skill undone too: the
// rollback writes the skill back to what it was before ev, so an edit made
// after it (the person's or Timely's) is gone with it.
func (s *Service) supersede(ctx context.Context, uid string, ev Event) {
	var later []Event
	if err := s.db.WithContext(ctx).
		Where("user_id = ? AND kind = ? AND subject = ? AND status IN ? AND created_at > ? AND id <> ?",
			uid, KindSkill, ev.Subject, []string{StatusApplied, StatusKept}, ev.CreatedAt, ev.ID).
		Find(&later).Error; err != nil {
		return
	}
	for _, l := range later {
		if ok, err := s.claim(ctx, uid, l.ID, []string{l.Status}, StatusUndone); err == nil && ok {
			l.Status = StatusUndone
			s.publishEvent(uid, l)
		}
	}
}

// supersedeMemory marks the account's applied or kept About you or Notes
// changes that wrote the entry old as undone, once a person's edit or an
// Undo replaced or removed it: their Undo could only fail now ("can't find
// that entry").
func (s *Service) supersedeMemory(ctx context.Context, uid, target, old, except string) {
	if strings.TrimSpace(old) == "" {
		return
	}
	var earlier []Event
	if err := s.db.WithContext(ctx).
		Where("user_id = ? AND kind = ? AND status IN ? AND \"after\" = ? AND id <> ?",
			uid, target, []string{StatusApplied, StatusKept}, old, except).
		Find(&earlier).Error; err != nil {
		s.logf("learning: superseding memory changes: %v", err)
		return
	}
	for _, e := range earlier {
		if ok, err := s.claim(ctx, uid, e.ID, []string{e.Status}, StatusUndone); err == nil && ok {
			e.Status = StatusUndone
			s.publishEvent(uid, e)
		}
	}
}

func undoRefusal(status string) string {
	switch status {
	case StatusUndone:
		return "Already undone"
	case StatusStaged:
		return "This is waiting for you: keep or discard it instead"
	case StatusDiscarded:
		return "Already discarded"
	}
	return "Only something Timely learned can be undone"
}

// listSkills is the account's skills from its worker, with what Timely
// keeps itself: turned off by the person, and "restored, review".
func (s *Service) listSkills(c *echo.Context) error {
	data, err := s.ask(c, "learning.list", map[string]any{"what": "skills"})
	if err != nil {
		return err
	}
	row, err := loadSettings(c.Request().Context(), s.db, user(c))
	if err != nil {
		return err
	}
	skills, err := workerList(data, "skills")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "The agent's skill list could not be read.")
	}
	for _, skill := range skills {
		name, _ := skill["name"].(string)
		enabled, _ := skill["enabled"].(bool)
		skill["enabled"] = enabled && !slices.Contains(row.SkillsDisabled, name)
		skill["restored"] = slices.Contains(row.SkillsRestored, name)
	}
	return c.JSON(http.StatusOK, map[string]any{"skills": skills})
}

func nameParam(c *echo.Context, key string) (string, error) {
	name := c.Param(key)
	if !validName(name) {
		return "", echo.NewHTTPError(http.StatusNotFound, "Not found")
	}
	return name, nil
}

func (s *Service) getSkill(c *echo.Context) error {
	name, err := nameParam(c, "name")
	if err != nil {
		return err
	}
	fields := map[string]any{"name": name}
	if entry := c.QueryParam("entry"); entry != "" {
		fields["entry"] = cut(entry, 128)
	}
	data, err := s.ask(c, "learning.skill", fields)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, data)
}

// maxSkillBytes caps a skill the person edits (Hermes' own cap is larger;
// a skill this long is no longer one).
const maxSkillBytes = 100_000

func (s *Service) editSkill(c *echo.Context) error {
	name, err := nameParam(c, "name")
	if err != nil {
		return err
	}
	var in struct {
		Content string `json:"content"`
	}
	if err := c.Bind(&in); err != nil || strings.TrimSpace(in.Content) == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Write the skill first")
	}
	if len(in.Content) > maxSkillBytes {
		return echo.NewHTTPError(http.StatusBadRequest, "That skill is too long")
	}
	data, err := s.ask(c, "learning.edit", map[string]any{"name": name, "content": in.Content})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, data)
}

var workerSkillStates = []string{"lock", "unlock", "archive", "restore", "delete"}

// skillState turns a skill on or off (kept by Timely: skills_disabled, then
// the worker's config is rendered again) or locks, archives, restores or
// deletes it (the worker).
func (s *Service) skillState(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	name, err := nameParam(c, "name")
	if err != nil {
		return err
	}
	var in struct {
		State string `json:"state"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid state")
	}
	switch {
	case in.State == "enable" || in.State == "disable":
		disabled, err := s.setSkillEnabled(c.Request().Context(), uid, name, in.State == "enable")
		if err != nil {
			return err
		}
		return c.JSON(http.StatusOK, map[string]any{"name": name, "enabled": in.State == "enable", "skillsDisabled": disabled})
	case slices.Contains(workerSkillStates, in.State):
		data, err := s.ask(c, "learning.skill_state", map[string]any{"name": name, "state": in.State})
		if err != nil {
			return err
		}
		// A delete the worker answered with reset brought a built-in skill's
		// shipped copy back: the skill is still there, so its marks stay.
		var answer struct {
			Reset bool `json:"reset"`
		}
		_ = json.Unmarshal(data, &answer)
		if in.State == "delete" && !answer.Reset {
			if err := s.forgetSkill(c.Request().Context(), uid, name); err != nil {
				return err
			}
		}
		return c.JSON(http.StatusOK, data)
	}
	return echo.NewHTTPError(http.StatusBadRequest, "State must be enable, disable, lock, unlock, archive, restore or delete")
}

// setSkillEnabled turns a skill on (also clearing "restored, review", and
// listing it in skills_enabled so a bundled skill that is off by default
// loads) or off, and tells a running worker: settings.update with the
// account's settings, or, without a settings source, a restart once it is
// idle.
func (s *Service) setSkillEnabled(ctx context.Context, uid, name string, enabled bool) ([]string, error) {
	var disabled []string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row, err := lockedSettings(tx, uid)
		if err != nil {
			return err
		}
		restored, on := row.SkillsRestored, without(row.SkillsEnabled, name)
		if enabled {
			disabled, restored, on = without(row.SkillsDisabled, name), without(row.SkillsRestored, name), union(row.SkillsEnabled, name)
		} else {
			disabled = union(row.SkillsDisabled, name)
		}
		if err := saveSkillsEnabled(tx, uid, on); err != nil {
			return err
		}
		return saveSkillLists(tx, uid, disabled, restored)
	})
	if err != nil {
		return nil, err
	}
	s.pushSettings(ctx, uid)
	return disabled, nil
}

// forgetSkill drops a deleted skill from Timely's own lists.
func (s *Service) forgetSkill(ctx context.Context, uid, name string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row, err := lockedSettings(tx, uid)
		if err != nil {
			return err
		}
		if err := saveSkillsEnabled(tx, uid, without(row.SkillsEnabled, name)); err != nil {
			return err
		}
		return saveSkillLists(tx, uid, without(row.SkillsDisabled, name), without(row.SkillsRestored, name))
	})
}

// StopLearning tells a running worker to write no more memory or skills
// from the chat cid (every chat when cid is ""), and to cancel a learning
// pass still going: the person chose "Don't learn from this chat" or turned
// learning off (ADR 0028). A worker that is not running has no pass to stop,
// and its next run.start carries the switch.
func (s *Service) StopLearning(ctx context.Context, uid, cid string) {
	if s.workers == nil {
		return
	}
	w, ok := s.workers.Worker(uid)
	if !ok {
		return
	}
	fields := map[string]any{}
	if cid != "" {
		fields["conversation_id"] = cid
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	release := w.Hold()
	defer release()
	if _, err := askWorker(ctx, w, "learning.stop", fields); err != nil {
		s.logf("learning: learning.stop: %v", err)
	}
}

// pushSettings brings a running worker's config.yaml up to date. A worker
// that is not running renders the settings when it next starts.
func (s *Service) pushSettings(ctx context.Context, uid string) {
	if s.workers == nil {
		return
	}
	w, ok := s.workers.Worker(uid)
	if !ok {
		return
	}
	s.mu.Lock()
	settings := s.settings
	s.mu.Unlock()
	if settings == nil {
		if r, ok := s.workers.(interface{ RestartWhenIdle(string) }); ok {
			r.RestartWhenIdle(uid)
		}
		return
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	raw, err := settings(ctx, uid)
	if err == nil {
		release := w.Hold()
		_, err = askWorker(ctx, w, "settings.update", map[string]any{"settings": raw})
		release()
	}
	if err != nil {
		s.logf("learning: settings.update: %v; restarting the worker when idle", err)
		if r, ok := s.workers.(interface{ RestartWhenIdle(string) }); ok {
			r.RestartWhenIdle(uid)
		}
	}
}

func (s *Service) getMemory(c *echo.Context) error {
	data, err := s.ask(c, "learning.list", map[string]any{"what": "memory"})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, data)
}

// maxMemoryEntry caps one entry the person writes (About you holds 1,375
// characters in all, Notes 2,200; the worker checks the budget).
const maxMemoryEntry = 2200

func (s *Service) editMemory(c *echo.Context) error {
	var in struct {
		Target  string `json:"target"`
		Action  string `json:"action"`
		Content string `json:"content"`
		Old     string `json:"old"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid change")
	}
	if in.Target != KindMemory && in.Target != KindUser {
		return echo.NewHTTPError(http.StatusBadRequest, "target must be memory or user")
	}
	switch in.Action {
	case "add":
		if strings.TrimSpace(in.Content) == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "Write something first")
		}
	case "replace":
		if strings.TrimSpace(in.Content) == "" || in.Old == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "Say which entry and what it becomes")
		}
	case "remove":
		if in.Old == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "Say which entry to remove")
		}
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "action must be add, replace or remove")
	}
	if len([]rune(in.Content)) > maxMemoryEntry || len([]rune(in.Old)) > maxMemoryEntry {
		return echo.NewHTTPError(http.StatusBadRequest, "That entry is too long")
	}
	data, err := s.ask(c, "learning.memory", map[string]any{"target": in.Target, "action": in.Action, "content": in.Content, "old": in.Old})
	if err != nil {
		return err
	}
	if in.Action != "add" {
		// What wrote the old entry can no longer be undone.
		s.supersedeMemory(c.Request().Context(), user(c), in.Target, in.Old, "")
	}
	return c.JSON(http.StatusOK, data)
}

func (s *Service) listPending(c *echo.Context) error {
	data, err := s.ask(c, "learning.list", map[string]any{"what": "pending"})
	if err != nil {
		return err
	}
	pending, err := workerList(data, "pending")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "The agent's waiting changes could not be read.")
	}
	return c.JSON(http.StatusOK, map[string]any{"pending": pending})
}

// workerList reads a learning.list reply: the worker wraps it as
// {key: [...]}; a bare list is accepted too. It never answers nil.
func workerList(data json.RawMessage, key string) ([]map[string]any, error) {
	var list []map[string]any
	if err := json.Unmarshal(data, &list); err != nil {
		var wrapped map[string][]map[string]any
		if err := json.Unmarshal(data, &wrapped); err != nil {
			return nil, err
		}
		list = wrapped[key]
	}
	if list == nil {
		list = []map[string]any{}
	}
	return list, nil
}

// decidePending keeps or discards a staged change. The pending id must be
// one of the account's own staged events, so another account's id answers
// not-found without reaching any worker.
func (s *Service) decidePending(c *echo.Context) error {
	uid, err := signedIn(c)
	if err != nil {
		return err
	}
	var in struct {
		Choice string `json:"choice"`
	}
	if err := c.Bind(&in); err != nil || (in.Choice != "keep" && in.Choice != "discard") {
		return echo.NewHTTPError(http.StatusBadRequest, "choice must be keep or discard")
	}
	ctx := c.Request().Context()
	pendingID := c.Param("pendingId")
	var events []Event
	if err := s.db.WithContext(ctx).Where("user_id = ? AND pending_id = ? AND pending_id <> ''", uid, pendingID).
		Order("created_at DESC").Limit(1).Find(&events).Error; err != nil {
		return err
	}
	if len(events) == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "Not found")
	}
	ev := events[0]
	if ev.Status != StatusStaged {
		return echo.NewHTTPError(http.StatusConflict, "Already decided")
	}
	status := StatusKept
	if in.Choice == "discard" {
		status = StatusDiscarded
	}
	ok, err := s.claim(ctx, uid, ev.ID, []string{StatusStaged}, status)
	if err != nil {
		return err
	}
	if !ok {
		return echo.NewHTTPError(http.StatusConflict, "Already decided")
	}
	data, err := s.ask(c, "learning.pending", map[string]any{"pending_id": ev.PendingID, "choice": in.Choice})
	var he *echo.HTTPError
	if err != nil && status == StatusDiscarded && errors.As(err, &he) && he.Code == http.StatusNotFound {
		// The worker no longer holds the change (a restore whose agent home
		// did not come back, a pending file removed by hand): there is
		// nothing to throw away, so Discard just closes it.
		data, err = json.RawMessage(`{"gone":true}`), nil
	}
	if err != nil {
		s.unclaim(uid, ev.ID, StatusStaged)
		return err
	}
	ev.Status = status
	if status == StatusKept {
		s.keptAsApplied(ctx, uid, &ev, data)
	}
	s.publishEvent(uid, ev)
	return c.JSON(http.StatusOK, map[string]any{"event": ev, "result": data})
}

// keptAsApplied gives a kept change what Undo needs from the worker's keep
// reply (the applied events, which the worker reports nowhere else): the
// row takes the last change's ledger entry and before and after texts, and
// any earlier change of the same keep (a memory batch) becomes a kept row of
// its own, so each can be undone.
func (s *Service) keptAsApplied(ctx context.Context, uid string, ev *Event, data json.RawMessage) {
	var reply struct {
		Events []wireEvent `json:"events"`
	}
	if json.Unmarshal(data, &reply) != nil || len(reply.Events) == 0 {
		return
	}
	var applied []Event
	for _, w := range reply.Events {
		if a, err := eventFromWire(w); err == nil && a.Status == StatusApplied {
			applied = append(applied, a)
		}
	}
	if len(applied) == 0 {
		return
	}
	last := applied[len(applied)-1]
	ev.LedgerEntryID = last.LedgerEntryID
	if last.Before != "" || last.After != "" {
		ev.Before, ev.After = last.Before, last.After
	}
	if err := s.db.WithContext(ctx).Model(&Event{}).Where("id = ? AND user_id = ?", ev.ID, uid).
		Updates(map[string]any{"ledger_entry_id": ev.LedgerEntryID, "before": ev.Before, "after": ev.After, "updated_at": time.Now()}).Error; err != nil {
		s.logf("learning: a kept change's history entry: %v", err)
	}
	for _, extra := range applied[:len(applied)-1] {
		extra.ID, extra.UserID, extra.Status, extra.PendingID = "lev_"+uuid.NewString(), uid, StatusKept, ev.PendingID
		if extra.ConversationID == "" {
			extra.ConversationID = ev.ConversationID
		}
		res := s.db.WithContext(ctx).Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "worker_event_id"}},
			DoNothing: true,
		}).Create(&extra)
		if res.Error != nil {
			s.logf("learning: a kept change's other part: %v", res.Error)
		} else if res.RowsAffected == 1 {
			s.publishEvent(uid, extra)
		}
	}
}

func (s *Service) listUpstream(c *echo.Context) error {
	data, err := s.ask(c, "learning.upstream", map[string]any{"action": "list"})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, data)
}

func (s *Service) compareUpstream(c *echo.Context) error {
	name, err := nameParam(c, "name")
	if err != nil {
		return err
	}
	data, err := s.ask(c, "learning.upstream", map[string]any{"action": "compare", "name": name})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, data)
}

func (s *Service) chooseUpstream(c *echo.Context) error {
	name, err := nameParam(c, "name")
	if err != nil {
		return err
	}
	var in struct {
		Choice string `json:"choice"`
	}
	if err := c.Bind(&in); err != nil || (in.Choice != "keep_mine" && in.Choice != "use_new") {
		return echo.NewHTTPError(http.StatusBadRequest, "choice must be keep_mine or use_new")
	}
	data, err := s.ask(c, "learning.upstream", map[string]any{"action": in.Choice, "name": name})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, data)
}

// export is "Download what Timely learned": the worker's zip of learned and
// edited skills and memory files.
func (s *Service) export(c *echo.Context) error {
	data, err := s.ask(c, "learning.export", map[string]any{})
	if err != nil {
		return err
	}
	var body struct {
		ZipB64 string `json:"zip_b64"`
	}
	if json.Unmarshal(data, &body) != nil || body.ZipB64 == "" {
		return echo.NewHTTPError(http.StatusBadGateway, "The agent sent no export.")
	}
	zip, err := base64.StdEncoding.DecodeString(body.ZipB64)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "The agent's export could not be read.")
	}
	c.Response().Header().Set("Content-Disposition", `attachment; filename="what-timely-learned.zip"`)
	return c.Blob(http.StatusOK, "application/zip", zip)
}
