package focus

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// Goal progress: which open Work moves each goal forward. Code picks the
// shortlist (open Work, soonest first) and Jev only says which goal, if any,
// each task moves forward. Answers are kept per task with hashes of the goals
// and the task's words, so a page load asks only about new or changed Work.

const (
	ProgressFeature  = "goal_progress"
	progressBudget   = 8 * time.Second
	maxProgressTasks = 40
	progressBatch    = 20
	tagsKeptFor      = 30 * 24 * time.Hour
)

// Decider is the part of the decision service goal progress uses.
type Decider interface {
	Status(ctx context.Context, userID string) (bool, string)
	Ask(ctx context.Context, userID string, req decide.Request) (decide.Answers, error)
}

// GoalOptions are the options of "which goal does this move forward": none,
// then g1..gN in the person's order. Today's suggestions ask the same.
func GoalOptions(goals []string) []decide.Option {
	if len(goals) == 0 {
		return nil
	}
	opts := []decide.Option{{Name: "none", Description: "None of the person's goals"}}
	for i, g := range goals {
		opts = append(opts, decide.Option{Name: fmt.Sprintf("g%d", i+1), Description: clip(g, 120)})
	}
	return opts
}

// GoalQuestion asks which goal the named task (for example "task t3") moves
// forward.
func GoalQuestion(which string, opts []decide.Option) decide.Question {
	return decide.Choice(fmt.Sprintf("Which of the person's goals does %s clearly move forward, if any?", which), opts...)
}

// ReadGoal is the index of the goal Jev picked for a GoalQuestion (Prefill),
// or -1 for none or unsure.
func ReadGoal(a decide.Answers, id string, count int) int {
	g, ok := a.Choice(id, decide.Prefill)
	if !ok || g == "none" {
		return -1
	}
	var n int
	if _, err := fmt.Sscanf(g, "g%d", &n); err != nil || n < 1 || n > count {
		return -1
	}
	return n - 1
}

// GoalsHash changes when a goal is added, removed, renamed or moved. The
// prefix changes when the question itself changes (v2: tasks carry their
// project), so older answers are asked again once.
func GoalsHash(goals []Goal) string {
	h := sha256.New()
	h.Write([]byte("v2\x02"))
	for _, g := range goals {
		h.Write([]byte(g.ID + "\x00" + g.Title + "\x01"))
	}
	return hex.EncodeToString(h.Sum(nil)[:8])
}

// TaskHash changes when the words Jev reads change.
func TaskHash(name, description string) string {
	sum := sha256.Sum256([]byte(name + "\x00" + description))
	return hex.EncodeToString(sum[:8])
}

// ProgressItem is open Work that moves a goal forward.
type ProgressItem struct {
	TaskID   string `json:"taskId"`
	Name     string `json:"name"`
	Deadline string `json:"deadline,omitempty"`
}

type GoalProgress struct {
	GoalID string         `json:"goalId"`
	Title  string         `json:"title"`
	Items  []ProgressItem `json:"items"`
}

// Progress is the answer of GET /goals/progress. Available is false when
// smart suggestions are off; the goals themselves still work.
type Progress struct {
	Available bool           `json:"available"`
	Error     string         `json:"error,omitempty"`
	Goals     []GoalProgress `json:"goals"`
}

// ProjectTitles names the project of each task that has one, so Jev can
// tell apart similar Work in different projects ("launch" in a shop project
// versus an app project).
func ProjectTitles(ctx context.Context, db *gorm.DB, userID string, tasks []models.Task) map[string]string {
	out := map[string]string{}
	var ids []string
	for _, t := range tasks {
		if t.ProjectID != nil && *t.ProjectID != "" {
			ids = append(ids, *t.ProjectID)
		}
	}
	if len(ids) == 0 {
		return out
	}
	var rows []struct{ ID, Title string }
	db.WithContext(ctx).Table("projects p").Select("p.id, p.title").
		Joins("JOIN workspaces w ON w.id = p.workspace_id").
		Where("p.id IN ? AND w.user_id = ?", ids, userID).Scan(&rows)
	titles := map[string]string{}
	for _, r := range rows {
		titles[r.ID] = r.Title
	}
	for _, t := range tasks {
		if t.ProjectID != nil && titles[*t.ProjectID] != "" {
			out[t.ID] = titles[*t.ProjectID]
		}
	}
	return out
}

// openWork is the shortlist: open Work, soonest deadline first, then the
// most recently touched.
func (s *Store) openWork(ctx context.Context, userID string) ([]models.Task, error) {
	var tasks []models.Task
	err := s.conn(ctx).Select("id", "name", "description", "deadline", "project_id").
		Where("user_id = ? AND kind = ? AND completed_at IS NULL", userID, models.KindTask).
		Order("deadline ASC NULLS LAST, updated_at DESC, id").Limit(maxProgressTasks).Find(&tasks).Error
	return tasks, err
}

// Remember stores goal tags another feature already asked about (Today's
// suggestions), so goal progress does not ask about them again. picks maps
// a task to the index of its goal, -1 for none.
func (s *Store) Remember(ctx context.Context, userID string, goals []Goal, tasks []models.Task, picks map[string]int) {
	if len(goals) == 0 || len(picks) == 0 {
		return
	}
	gh := GoalsHash(goals)
	now := time.Now().UTC()
	rows := make([]GoalTaskTag, 0, len(picks))
	for _, t := range tasks {
		i, ok := picks[t.ID]
		if !ok {
			continue
		}
		row := GoalTaskTag{UserID: userID, TaskID: t.ID, GoalsHash: gh, TaskHash: TaskHash(t.Name, t.Description), UpdatedAt: now}
		if i >= 0 && i < len(goals) {
			row.GoalID = goals[i].ID
		}
		rows = append(rows, row)
	}
	s.saveTags(ctx, rows)
}

func (s *Store) saveTags(ctx context.Context, rows []GoalTaskTag) {
	if len(rows) == 0 {
		return
	}
	s.conn(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "task_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"goals_hash", "task_hash", "goal_id", "updated_at"}),
	}).Create(&rows)
}

// Progress lists, per goal, the open Work that moves it forward.
func (s *Store) Progress(ctx context.Context, d Decider, userID string) (Progress, error) {
	out := Progress{Goals: []GoalProgress{}}
	if d == nil {
		return out, nil
	}
	if ok, _ := d.Status(ctx, userID); !ok {
		return out, nil
	}
	out.Available = true
	goals, err := s.Goals(ctx, userID)
	if err != nil || len(goals) == 0 {
		return out, err
	}
	tasks, err := s.openWork(ctx, userID)
	if err != nil {
		return out, err
	}
	gh := GoalsHash(goals)
	tags := map[string]string{}
	if len(tasks) > 0 {
		ids := make([]string, len(tasks))
		for i, t := range tasks {
			ids[i] = t.ID
		}
		var cached []GoalTaskTag
		if err := s.conn(ctx).Where("user_id = ? AND task_id IN ?", userID, ids).Find(&cached).Error; err != nil {
			return out, err
		}
		byTask := map[string]GoalTaskTag{}
		for _, c := range cached {
			byTask[c.TaskID] = c
		}
		var need []models.Task
		for _, t := range tasks {
			if c, ok := byTask[t.ID]; ok && c.GoalsHash == gh && c.TaskHash == TaskHash(t.Name, t.Description) {
				tags[t.ID] = c.GoalID
			} else {
				need = append(need, t)
			}
		}
		if len(need) > 0 {
			askCtx, cancel := context.WithTimeout(ctx, progressBudget)
			picks, failed := TagTasks(askCtx, d, userID, goals, need, ProjectTitles(ctx, s.db, userID, need))
			cancel()
			if failed != nil {
				out.Error = failure(askCtx, failed)
			}
			s.Remember(ctx, userID, goals, need, picks)
			for id, i := range picks {
				if i >= 0 {
					tags[id] = goals[i].ID
				}
			}
		}
	}
	s.conn(ctx).Where("user_id = ? AND updated_at < ?", userID, time.Now().Add(-tagsKeptFor)).Delete(&GoalTaskTag{})
	for _, g := range goals {
		gp := GoalProgress{GoalID: g.ID, Title: g.Title, Items: []ProgressItem{}}
		for _, t := range tasks {
			if tags[t.ID] == g.ID {
				gp.Items = append(gp.Items, ProgressItem{TaskID: t.ID, Name: t.Name, Deadline: models.NormalizeDate(derefStr(t.Deadline))})
			}
		}
		out.Goals = append(out.Goals, gp)
	}
	return out, nil
}

// TagTasks asks, in batches side by side, which goal each task moves
// forward. picks holds every task of a batch that was answered (-1 for none
// or unsure); a batch that failed is left out, so it is asked again next
// time, and the first failure is returned.
// projects names each task's project (ProjectTitles); nil is fine.
func TagTasks(ctx context.Context, d Decider, userID string, goals []Goal, tasks []models.Task, projects map[string]string) (map[string]int, error) {
	titles := make([]string, len(goals))
	for i, g := range goals {
		titles[i] = g.Title
	}
	opts := GoalOptions(titles)
	picks := map[string]int{}
	var mu sync.Mutex
	var first error
	var wg sync.WaitGroup
	for start := 0; start < len(tasks); start += progressBatch {
		batch := tasks[start:min(start+progressBatch, len(tasks))]
		wg.Add(1)
		go func() {
			defer wg.Done()
			list := make([]map[string]any, 0, len(batch))
			questions := map[string]decide.Question{}
			for i, t := range batch {
				key := fmt.Sprintf("t%d", i+1)
				item := map[string]any{"task": key, "title": clip(t.Name, 200)}
				if desc := strings.TrimSpace(t.Description); desc != "" {
					item["description"] = clip(desc, 300)
				}
				if p := projects[t.ID]; p != "" {
					item["project"] = clip(p, 120)
				}
				list = append(list, item)
				questions["goal_"+key] = GoalQuestion("task "+key, opts)
			}
			a, err := d.Ask(ctx, userID, decide.Request{Feature: ProgressFeature,
				State: map[string]any{"goals": titles, "tasks": list}, Questions: questions})
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if first == nil {
					first = err
				}
				return
			}
			for i, t := range batch {
				picks[t.ID] = ReadGoal(a, fmt.Sprintf("goal_t%d", i+1), len(goals))
			}
		}()
	}
	wg.Wait()
	return picks, first
}

// failure is the line shown when Jev could not answer; plain ErrOff (off,
// no key or busy) shows nothing.
func failure(ctx context.Context, err error) string {
	switch {
	case err == decide.ErrOff:
		return ""
	case ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded):
		return "Smart suggestions took too long to answer."
	}
	msg := err.Error()
	if i := strings.LastIndex(msg, "\n"); i >= 0 {
		msg = msg[i+1:]
	}
	return "Smart suggestions could not run: " + msg
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func derefStr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
