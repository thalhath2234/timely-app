// Package focus holds the person's habits and goals, shown together at the
// top of Today on every surface. Habits are checked off per day and their
// streaks are counted here, from the client's own date, so an unchecked today
// never breaks yesterday's streak. Goals are the person's own words; smart
// suggestions (Jev) only say which open Work moves each one forward, and
// everything else works without a key.
package focus

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

const (
	MaxHabits  = 20
	MaxGoals   = 5
	MaxNameLen = 80
	// streakWindow is how many days of checks one read loads; a streak that
	// reaches past it loads that habit's older checks.
	streakWindow = 62
	dayLayout    = "2006-01-02"
)

// Habit is something the person wants to do every day.
type Habit struct {
	ID        string    `gorm:"type:text;primaryKey" json:"id"`
	UserID    string    `gorm:"type:text;not null;index" json:"-"`
	Name      string    `gorm:"type:text;not null" json:"name"`
	Position  int       `gorm:"not null;default:0" json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// HabitCheck is one day a habit was done.
type HabitCheck struct {
	HabitID   string    `gorm:"type:text;primaryKey"`
	UserID    string    `gorm:"type:text;not null;index"`
	Day       string    `gorm:"type:date;primaryKey"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
}

// Goal is one of the person's goals, in their own words.
type Goal struct {
	ID        string    `gorm:"type:text;primaryKey" json:"id"`
	UserID    string    `gorm:"type:text;not null;index" json:"-"`
	Title     string    `gorm:"type:text;not null" json:"title"`
	Position  int       `gorm:"not null;default:0" json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// GoalTaskTag caches which goal an open task moves forward (GoalID "" for
// none or unsure), valid while both hashes match.
type GoalTaskTag struct {
	UserID    string `gorm:"type:text;primaryKey"`
	TaskID    string `gorm:"type:text;primaryKey"`
	GoalsHash string `gorm:"type:text;not null"`
	TaskHash  string `gorm:"type:text;not null"`
	GoalID    string `gorm:"type:text;not null;default:''"`
	UpdatedAt time.Time
}

// Models lists the tables, for tests that build them with AutoMigrate.
var Models = []any{&Habit{}, &HabitCheck{}, &Goal{}, &GoalTaskTag{}}

// HabitView is a habit with today's state, computed for the client's date.
type HabitView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Position  int    `json:"position"`
	DoneToday bool   `json:"doneToday"`
	Streak    int    `json:"streak"`
	// Last7 holds the last seven days, oldest first; the last one is today.
	Last7 []bool `json:"last7"`
}

var ErrNotFound = errors.New("not found")

// InputError is a request the person can fix; its text is shown as is.
type InputError struct{ Message string }

func (e *InputError) Error() string { return e.Message }

func invalid(format string, args ...any) error {
	return &InputError{Message: fmt.Sprintf(format, args...)}
}

// Store reads and writes habits and goals. It is a thin wrapper over a
// connection, so the agent can build one on a chat transaction.
type Store struct{ db *gorm.DB }

func NewStore(db *gorm.DB) *Store { return &Store{db: db} }

func (s *Store) conn(ctx context.Context) *gorm.DB { return s.db.WithContext(ctx) }

// CleanName collapses spaces and checks the length.
func CleanName(raw, what string) (string, error) {
	name := strings.Join(strings.Fields(raw), " ")
	if name == "" {
		return "", invalid("Give the %s a name", what)
	}
	if len([]rune(name)) > MaxNameLen {
		return "", invalid("Keep the %s under %d characters", what, MaxNameLen)
	}
	return name, nil
}

// ParseDay reads a YYYY-MM-DD date and rejects anything else.
func ParseDay(raw string) (time.Time, error) {
	d, err := time.Parse(dayLayout, raw)
	if err != nil || d.Format(dayLayout) != raw {
		return time.Time{}, invalid("Use a date like 2026-01-31")
	}
	return d, nil
}

// Today is the account's date: saved Working hours zone, then the client's
// zone, then the server's, as on the Today view.
func (s *Store) Today(ctx context.Context, userID, timezone string) string {
	day, err := task.TodayForUser(schedule.NewRepository(s.conn(ctx)).GetWorkingHours, userID, timezone, time.Now())
	if err != nil {
		day = task.TodayFor(models.WorkingHours{}, timezone, time.Now())
	}
	return day.Date()
}

// ---- Habits ----

func (s *Store) habitRows(ctx context.Context, userID string) ([]Habit, error) {
	var out []Habit
	err := s.conn(ctx).Where("user_id = ?", userID).Order("position, created_at, id").Find(&out).Error
	return out, err
}

// Habits lists the person's habits with today's check, streak and last
// seven days, all judged against today (the client's date).
func (s *Store) Habits(ctx context.Context, userID string, today time.Time) ([]HabitView, error) {
	rows, err := s.habitRows(ctx, userID)
	if err != nil || len(rows) == 0 {
		return []HabitView{}, err
	}
	since := today.AddDate(0, 0, -streakWindow)
	var checks []struct {
		HabitID string
		Day     string
	}
	if err := s.conn(ctx).Table("habit_checks").Select("habit_id, to_char(day, 'YYYY-MM-DD') AS day").
		Where("user_id = ? AND day >= ? AND day <= ?", userID, since.Format(dayLayout), today.Format(dayLayout)).
		Scan(&checks).Error; err != nil {
		return nil, err
	}
	done := map[string]map[string]bool{}
	for _, c := range checks {
		if done[c.HabitID] == nil {
			done[c.HabitID] = map[string]bool{}
		}
		done[c.HabitID][c.Day] = true
	}
	out := make([]HabitView, 0, len(rows))
	for _, h := range rows {
		days := done[h.ID]
		if days == nil {
			days = map[string]bool{}
		}
		streak := Streak(days, today)
		if streak > 0 && days[since.Format(dayLayout)] && streakStart(days, today, streak).Equal(since) {
			// The run reaches the window's first day: read the older checks.
			var older []string
			if err := s.conn(ctx).Table("habit_checks").Select("to_char(day, 'YYYY-MM-DD')").
				Where("habit_id = ? AND user_id = ? AND day < ?", h.ID, userID, since.Format(dayLayout)).
				Scan(&older).Error; err != nil {
				return nil, err
			}
			for _, d := range older {
				days[d] = true
			}
			streak = Streak(days, today)
		}
		out = append(out, HabitView{ID: h.ID, Name: h.Name, Position: h.Position, DoneToday: days[today.Format(dayLayout)],
			Streak: streak, Last7: Last7(days, today)})
	}
	return out, nil
}

// Streak is the current run of days the habit was done. Today not done yet
// does not break it: the run then ends yesterday.
func Streak(done map[string]bool, today time.Time) int {
	cursor := today
	if !done[cursor.Format(dayLayout)] {
		cursor = cursor.AddDate(0, 0, -1)
	}
	n := 0
	for done[cursor.Format(dayLayout)] {
		n++
		cursor = cursor.AddDate(0, 0, -1)
	}
	return n
}

// streakStart is the first day of a run of n days that Streak counted.
func streakStart(done map[string]bool, today time.Time, n int) time.Time {
	end := today
	if !done[end.Format(dayLayout)] {
		end = end.AddDate(0, 0, -1)
	}
	return end.AddDate(0, 0, -(n - 1))
}

// Last7 is whether the habit was done on each of the last seven days,
// oldest first, ending today.
func Last7(done map[string]bool, today time.Time) []bool {
	out := make([]bool, 7)
	for i := range out {
		out[i] = done[today.AddDate(0, 0, i-6).Format(dayLayout)]
	}
	return out
}

// FindHabit finds a habit by id, or by name ignoring case.
func (s *Store) FindHabit(ctx context.Context, userID, idOrName string) (Habit, error) {
	rows, err := s.habitRows(ctx, userID)
	if err != nil {
		return Habit{}, err
	}
	key := strings.Join(strings.Fields(idOrName), " ")
	for _, h := range rows {
		if h.ID == key {
			return h, nil
		}
	}
	for _, h := range rows {
		if strings.EqualFold(h.Name, key) {
			return h, nil
		}
	}
	return Habit{}, ErrNotFound
}

func (s *Store) AddHabit(ctx context.Context, userID, raw string) (Habit, error) {
	name, err := CleanName(raw, "habit")
	if err != nil {
		return Habit{}, err
	}
	var h Habit
	err = s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []Habit
		// Row locks miss the first add, so a per-account lock keeps two
		// adds at once from passing the cap or the duplicate check together.
		if err := lockAccount(tx, userID); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).Order("position").Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) >= MaxHabits {
			return invalid("You can keep up to %d habits", MaxHabits)
		}
		pos := 0
		for _, r := range rows {
			if strings.EqualFold(r.Name, name) {
				return invalid("You already have a habit called %q", r.Name)
			}
			pos = max(pos, r.Position+1)
		}
		now := time.Now().UTC()
		h = Habit{ID: utils.PrefixedUUID("hab"), UserID: userID, Name: name, Position: pos, CreatedAt: now, UpdatedAt: now}
		return tx.Create(&h).Error
	})
	return h, err
}

func (s *Store) RenameHabit(ctx context.Context, userID, id, raw string) (Habit, error) {
	name, err := CleanName(raw, "habit")
	if err != nil {
		return Habit{}, err
	}
	rows, err := s.habitRows(ctx, userID)
	if err != nil {
		return Habit{}, err
	}
	var found *Habit
	for i := range rows {
		if rows[i].ID == id {
			found = &rows[i]
		} else if strings.EqualFold(rows[i].Name, name) {
			return Habit{}, invalid("You already have a habit called %q", rows[i].Name)
		}
	}
	if found == nil {
		return Habit{}, ErrNotFound
	}
	found.Name, found.UpdatedAt = name, time.Now().UTC()
	err = s.conn(ctx).Model(&Habit{}).Where("id = ? AND user_id = ?", id, userID).
		Updates(map[string]any{"name": found.Name, "updated_at": found.UpdatedAt}).Error
	return *found, err
}

// DeleteHabit removes a habit and its checks.
func (s *Store) DeleteHabit(ctx context.Context, userID, id string) error {
	return s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&Habit{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrNotFound
		}
		// The foreign key cascades too; this keeps tests without it honest.
		return tx.Where("habit_id = ? AND user_id = ?", id, userID).Delete(&HabitCheck{}).Error
	})
}

func (s *Store) ReorderHabits(ctx context.Context, userID string, ids []string) error {
	return reorder(s.conn(ctx), &Habit{}, userID, ids)
}

// CheckHabit marks a habit done or not done on a day. Days more than a year
// back or after tomorrow (UTC, so every timezone's today fits) are refused.
func (s *Store) CheckHabit(ctx context.Context, userID, id, day string, done bool) error {
	d, err := ParseDay(day)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if d.After(now.AddDate(0, 0, 1)) || d.Before(now.AddDate(-1, 0, -1)) {
		return invalid("Pick a day within the last year")
	}
	var n int64
	if err := s.conn(ctx).Model(&Habit{}).Where("id = ? AND user_id = ?", id, userID).Count(&n).Error; err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if !done {
		return s.conn(ctx).Where("habit_id = ? AND user_id = ? AND day = ?", id, userID, day).Delete(&HabitCheck{}).Error
	}
	return s.conn(ctx).Clauses(clause.OnConflict{DoNothing: true}).
		Create(&HabitCheck{HabitID: id, UserID: userID, Day: day, CreatedAt: now}).Error
}

// ---- Goals ----

// Goals lists the person's goals in their order.
func (s *Store) Goals(ctx context.Context, userID string) ([]Goal, error) {
	out := []Goal{}
	err := s.conn(ctx).Where("user_id = ?", userID).Order("position, created_at, id").Limit(MaxGoals).Find(&out).Error
	return out, err
}

// GoalTitles is the goals in the person's words, for suggestions.
func (s *Store) GoalTitles(ctx context.Context, userID string) []string {
	goals, _ := s.Goals(ctx, userID)
	out := make([]string, len(goals))
	for i, g := range goals {
		out[i] = g.Title
	}
	return out
}

// FindGoal finds a goal by id, or by title ignoring case.
func (s *Store) FindGoal(ctx context.Context, userID, idOrTitle string) (Goal, error) {
	goals, err := s.Goals(ctx, userID)
	if err != nil {
		return Goal{}, err
	}
	key := strings.Join(strings.Fields(idOrTitle), " ")
	for _, g := range goals {
		if g.ID == key {
			return g, nil
		}
	}
	for _, g := range goals {
		if strings.EqualFold(g.Title, key) {
			return g, nil
		}
	}
	return Goal{}, ErrNotFound
}

func (s *Store) AddGoal(ctx context.Context, userID, raw string) (Goal, error) {
	title, err := CleanName(raw, "goal")
	if err != nil {
		return Goal{}, err
	}
	var g Goal
	err = s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []Goal
		// Row locks miss the first add, so a per-account lock keeps two
		// adds at once from passing the cap or the duplicate check together.
		if err := lockAccount(tx, userID); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) >= MaxGoals {
			return invalid("You can keep up to %d goals", MaxGoals)
		}
		pos := 0
		for _, r := range rows {
			if strings.EqualFold(r.Title, title) {
				return invalid("You already have the goal %q", r.Title)
			}
			pos = max(pos, r.Position+1)
		}
		now := time.Now().UTC()
		g = Goal{ID: utils.PrefixedUUID("goal"), UserID: userID, Title: title, Position: pos, CreatedAt: now, UpdatedAt: now}
		return tx.Create(&g).Error
	})
	return g, err
}

func (s *Store) RenameGoal(ctx context.Context, userID, id, raw string) (Goal, error) {
	title, err := CleanName(raw, "goal")
	if err != nil {
		return Goal{}, err
	}
	goals, err := s.Goals(ctx, userID)
	if err != nil {
		return Goal{}, err
	}
	var found *Goal
	for i := range goals {
		if goals[i].ID == id {
			found = &goals[i]
		} else if strings.EqualFold(goals[i].Title, title) {
			return Goal{}, invalid("You already have the goal %q", goals[i].Title)
		}
	}
	if found == nil {
		return Goal{}, ErrNotFound
	}
	found.Title, found.UpdatedAt = title, time.Now().UTC()
	err = s.conn(ctx).Model(&Goal{}).Where("id = ? AND user_id = ?", id, userID).
		Updates(map[string]any{"title": found.Title, "updated_at": found.UpdatedAt}).Error
	return *found, err
}

func (s *Store) DeleteGoal(ctx context.Context, userID, id string) error {
	res := s.conn(ctx).Where("id = ? AND user_id = ?", id, userID).Delete(&Goal{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ReorderGoals(ctx context.Context, userID string, ids []string) error {
	return reorder(s.conn(ctx), &Goal{}, userID, ids)
}

// reorder gives the listed rows positions in list order; rows the list
// leaves out keep their order after them. Unknown ids are refused.
func reorder(db *gorm.DB, model any, userID string, ids []string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var current []string
		if err := tx.Model(model).Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).
			Order("position, created_at, id").Pluck("id", &current).Error; err != nil {
			return err
		}
		known := map[string]bool{}
		for _, id := range current {
			known[id] = true
		}
		seen := map[string]bool{}
		order := make([]string, 0, len(current))
		for _, id := range ids {
			if !known[id] {
				return ErrNotFound
			}
			if !seen[id] {
				seen[id] = true
				order = append(order, id)
			}
		}
		for _, id := range current {
			if !seen[id] {
				order = append(order, id)
			}
		}
		now := time.Now().UTC()
		for i, id := range order {
			if err := tx.Model(model).Where("id = ? AND user_id = ?", id, userID).
				Updates(map[string]any{"position": i, "updated_at": now}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// lockAccount holds a transaction lock on the account's habits and goals.
func lockAccount(tx *gorm.DB, userID string) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtext('focus:' || ?))", userID).Error
}
