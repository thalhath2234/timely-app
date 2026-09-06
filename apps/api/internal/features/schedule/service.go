package schedule

import (
	"errors"
	"time"
	"timely-api/internal/blocks"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/event"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"

	"gorm.io/gorm"
)

const (
	defaultHorizonDays = 14
	maxHorizonDays     = 90
)

// PlanRequest scopes a preview / apply run. Empty TaskIDs means every
// schedulable task. IncludeManual lets the engine replace blocks the user
// placed by hand, which it never does on its own.
type PlanRequest struct {
	TaskIDs       []string
	From          *string
	To            *string
	Timezone      string
	IncludeManual bool
}

type BlockOut struct {
	Start      time.Time `json:"start"`
	End        time.Time `json:"end"`
	ChunkIndex int       `json:"chunkIndex"`
}

type ProposalOut struct {
	TaskID       string     `json:"taskId"`
	TaskName     string     `json:"taskName"`
	Blocks       []BlockOut `json:"blocks"`
	EndsAt       time.Time  `json:"endsAt"`
	Deadline     *time.Time `json:"deadline,omitempty"`
	PastDeadline bool       `json:"pastDeadline"`
}

type PlanResponse struct {
	From           time.Time     `json:"from"`
	To             time.Time     `json:"to"`
	Timezone       string        `json:"timezone"`
	Proposals      []ProposalOut `json:"proposals"`
	Skipped        []Skipped     `json:"skipped"`
	FreeMinutes    int           `json:"freeMinutes"`
	PlannedMinutes int           `json:"plannedMinutes"`
	Applied        bool          `json:"applied"`
}

type BlockInput struct {
	Start           string
	End             *string
	DurationMinutes *int
	Replace         bool
}

type WorkingHoursResponse struct {
	models.WorkingHours
	IsDefault bool `json:"isDefault"`
}

type Service interface {
	GetWorkingHours(userID, fallbackTimezone string) (*WorkingHoursResponse, error)
	UpdateWorkingHours(userID string, hours models.WorkingHours) (*WorkingHoursResponse, error)
	Preview(userID string, req PlanRequest) (*PlanResponse, error)
	Apply(userID string, req PlanRequest) (*PlanResponse, error)
	AddBlock(userID, taskID string, input BlockInput) (*models.Task, error)
	MoveBlock(userID, blockID string, start string, end *string) (*models.ScheduledBlock, error)
	DeleteBlock(userID, blockID string) error
	ClearBlocks(userID, taskID string) (*models.Task, error)
	FreeTime(userID string, from, to time.Time, timezone string) ([]Interval, error)
}

type service struct {
	repo   Repository
	tasks  task.TaskRepository
	events event.EventRepository
	blocks *blocks.Store
}

func NewService(repo Repository, tasks task.TaskRepository, events event.EventRepository, blockStore *blocks.Store) Service {
	return &service{repo: repo, tasks: tasks, events: events, blocks: blockStore}
}

func (s *service) GetWorkingHours(userID, fallbackTimezone string) (*WorkingHoursResponse, error) {
	hours, err := s.repo.GetWorkingHours(userID)
	if err != nil {
		return nil, err
	}
	if hours.IsEmpty() {
		return &WorkingHoursResponse{WorkingHours: models.DefaultWorkingHours(fallbackTimezone), IsDefault: true}, nil
	}
	return &WorkingHoursResponse{WorkingHours: hours}, nil
}

func (s *service) UpdateWorkingHours(userID string, hours models.WorkingHours) (*WorkingHoursResponse, error) {
	if hours.Days == nil {
		hours.Days = map[string][]models.WorkingWindow{}
	}
	if err := hours.Validate(); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateWorkingHours(userID, hours); err != nil {
		return nil, err
	}
	return &WorkingHoursResponse{WorkingHours: hours}, nil
}

func (s *service) Preview(userID string, req PlanRequest) (*PlanResponse, error) {
	plan, _, _, err := s.plan(userID, req)
	return plan, err
}

// Apply recomputes and writes engine blocks for every candidate. Candidates
// that no longer fit lose their stale engine blocks so the calendar never
// shows a plan the engine would not produce again.
func (s *service) Apply(userID string, req PlanRequest) (*PlanResponse, error) {
	plan, candidateIDs, replaceManual, err := s.plan(userID, req)
	if err != nil {
		return nil, err
	}

	err = s.blocks.DB().Transaction(func(tx *gorm.DB) error {
		store := s.blocks.WithTx(tx)
		if err := store.DeleteEngineBlocksForTasks(tx, candidateIDs); err != nil {
			return err
		}
		for _, id := range replaceManual {
			if err := store.DeleteForTask(id, models.BlockSourceManual); err != nil {
				return err
			}
		}
		var next []models.ScheduledBlock
		for _, proposal := range plan.Proposals {
			for _, block := range proposal.Blocks {
				next = append(next, models.ScheduledBlock{
					TaskID:     proposal.TaskID,
					UserID:     userID,
					StartAt:    block.Start,
					EndAt:      block.End,
					Source:     models.BlockSourceEngine,
					ChunkIndex: block.ChunkIndex,
				})
			}
		}
		return store.InsertMany(tx, next)
	})
	if err != nil {
		return nil, err
	}
	plan.Applied = true
	return plan, nil
}

// plan gathers availability, busy time and candidates, then runs the engine.
// It returns the candidate ids (whose engine blocks are replaceable) and the
// ids whose manual blocks the caller agreed to replace.
func (s *service) plan(userID string, req PlanRequest) (*PlanResponse, []string, []string, error) {
	if userID == "" {
		return nil, nil, nil, errors.New("user not authenticated")
	}

	hours, err := s.repo.GetWorkingHours(userID)
	if err != nil {
		return nil, nil, nil, err
	}
	loc := time.UTC
	if req.Timezone != "" {
		if parsed, err := time.LoadLocation(req.Timezone); err == nil {
			loc = parsed
		}
	}
	loc = hours.Location(loc)
	if hours.IsEmpty() {
		hours = models.DefaultWorkingHours(loc.String())
	}

	tasks, err := s.tasks.GetAllTaskByUser(userID)
	if err != nil {
		return nil, nil, nil, err
	}

	from, to, err := s.horizon(req, tasks, loc)
	if err != nil {
		return nil, nil, nil, err
	}

	events, err := s.events.ListInRange(userID, from, to)
	if err != nil {
		return nil, nil, nil, err
	}

	requested := map[string]bool{}
	for _, id := range req.TaskIDs {
		requested[id] = true
	}
	explicit := len(requested) > 0

	byID := make(map[string]*models.Task, len(tasks))
	for i := range tasks {
		byID[tasks[i].ID] = &tasks[i]
	}

	var candidates []Candidate
	var skipped []Skipped
	candidateSet := map[string]bool{}
	var replaceManual []string

	for i := range tasks {
		t := &tasks[i]
		if explicit && !requested[t.ID] {
			continue
		}
		// Done and repeating tasks are never engine work, so a full run stays
		// quiet about them; tasks the user could fix (no estimate, pinned by
		// hand) are always reported so the preview explains itself.
		switch {
		case t.IsCompleted():
			if explicit {
				skipped = append(skipped, Skipped{t.ID, t.Name, ReasonCompleted})
			}
			continue
		case t.IsRecurring():
			if explicit {
				skipped = append(skipped, Skipped{t.ID, t.Name, ReasonRecurring})
			}
			continue
		case t.Duration <= 0:
			skipped = append(skipped, Skipped{t.ID, t.Name, ReasonNoDuration})
			continue
		}
		if hasManualBlock(t) {
			if !req.IncludeManual {
				skipped = append(skipped, Skipped{t.ID, t.Name, ReasonManual})
				continue
			}
			replaceManual = append(replaceManual, t.ID)
		}
		candidateSet[t.ID] = true
		candidates = append(candidates, Candidate{
			ID:              t.ID,
			Name:            t.Name,
			DurationMinutes: t.Duration,
			ChunkMinutes:    t.ChunkMinutes(),
			Priority:        derefString(t.PriorityLevel),
			CreatedAt:       t.CreatedAt,
			Deadline:        parseDay(t.Deadline, loc),
			StartDate:       parseDay(t.StartDate, loc),
			BlockedByID:     derefString(t.BlockedByID),
		})
	}

	// Blockers outside the candidate set are resolved from their current
	// state: done means no constraint, scheduled means "after their last
	// block", anything else keeps the dependent task waiting.
	for i := range candidates {
		c := &candidates[i]
		if c.BlockedByID == "" || candidateSet[c.BlockedByID] {
			continue
		}
		blocker, ok := byID[c.BlockedByID]
		if !ok || blocker.IsCompleted() {
			c.BlockedByID = ""
			continue
		}
		if blocker.IsRecurring() {
			c.ExternalBlocked = true
			continue
		}
		if end := lastBlockEnd(blocker); end != nil {
			c.ExternalBlockerEnd = end
		} else {
			c.ExternalBlocked = true
		}
	}

	items, err := calendar.Collect(tasks, events, from, to)
	if err != nil {
		return nil, nil, nil, err
	}
	var busy []Interval
	for _, item := range items {
		if item.Kind == calendar.KindTask && candidateSet[item.TaskID] {
			// The engine rebuilds its own blocks; manual ones stay busy unless
			// the caller asked to replace them.
			if item.Source == models.BlockSourceEngine || req.IncludeManual {
				continue
			}
		}
		if item.AllDay {
			continue
		}
		busy = append(busy, Interval{Start: item.Start, End: item.End})
	}

	result := Plan(PlanInput{
		From:       from,
		To:         to,
		Location:   loc,
		Hours:      hours,
		Busy:       busy,
		Candidates: candidates,
	})

	response := &PlanResponse{
		From:           from,
		To:             to,
		Timezone:       loc.String(),
		Proposals:      make([]ProposalOut, 0, len(result.Proposals)),
		Skipped:        append(skipped, result.Skipped...),
		FreeMinutes:    result.FreeMinutes,
		PlannedMinutes: result.PlannedMinutes,
	}
	if response.Skipped == nil {
		response.Skipped = []Skipped{}
	}
	for _, proposal := range result.Proposals {
		out := ProposalOut{
			TaskID:       proposal.TaskID,
			TaskName:     proposal.TaskName,
			EndsAt:       proposal.EndsAt,
			Deadline:     proposal.Deadline,
			PastDeadline: proposal.PastDeadline,
			Blocks:       make([]BlockOut, 0, len(proposal.Blocks)),
		}
		for index, block := range proposal.Blocks {
			out.Blocks = append(out.Blocks, BlockOut{Start: block.Start, End: block.End, ChunkIndex: index})
		}
		response.Proposals = append(response.Proposals, out)
	}

	candidateIDs := make([]string, 0, len(candidateSet))
	for id := range candidateSet {
		candidateIDs = append(candidateIDs, id)
	}
	return response, candidateIDs, replaceManual, nil
}

// horizon picks the planning window: now (or `from`) to two weeks out, pushed
// to cover the latest deadline, capped at 90 days.
func (s *service) horizon(req PlanRequest, tasks []models.Task, loc *time.Location) (time.Time, time.Time, error) {
	from := time.Now().In(loc)
	if req.From != nil && *req.From != "" {
		parsed, err := recurrence.ParseTimeIn(*req.From, loc)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("invalid from")
		}
		if parsed.After(from) {
			from = parsed.In(loc)
		}
	}
	from = roundUp(from)

	to := from.AddDate(0, 0, defaultHorizonDays)
	if req.To != nil && *req.To != "" {
		parsed, err := recurrence.ParseTimeIn(*req.To, loc)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("invalid to")
		}
		to = parsed.In(loc)
	} else {
		for i := range tasks {
			t := &tasks[i]
			if t.IsCompleted() || t.IsRecurring() {
				continue
			}
			if deadline := parseDay(t.Deadline, loc); deadline != nil {
				if end := deadline.AddDate(0, 0, 1); end.After(to) {
					to = end
				}
			}
		}
	}
	if !to.After(from) {
		return time.Time{}, time.Time{}, errors.New("`to` must be after `from`")
	}
	if cap := from.AddDate(0, 0, maxHorizonDays); to.After(cap) {
		to = cap
	}
	return from, to, nil
}

func (s *service) AddBlock(userID, taskID string, input BlockInput) (*models.Task, error) {
	t, err := s.tasks.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if t.IsRecurring() {
		return nil, errors.New("recurring tasks are placed by their recurrence; move an occurrence instead")
	}
	start, err := recurrence.ParseTime(input.Start)
	if err != nil {
		return nil, errors.New("invalid start")
	}
	end, err := resolveEnd(start, input.End, input.DurationMinutes, t.Duration)
	if err != nil {
		return nil, err
	}

	block := models.ScheduledBlock{
		TaskID:  taskID,
		UserID:  userID,
		StartAt: start,
		EndAt:   end,
		Source:  models.BlockSourceManual,
	}
	if input.Replace {
		err = s.blocks.ReplaceForTask(taskID, userID, "", []models.ScheduledBlock{block})
	} else {
		block.ChunkIndex = len(t.Blocks)
		_, err = s.blocks.Create(&block)
	}
	if err != nil {
		return nil, err
	}
	return s.tasks.GetTaskByIdForUser(userID, taskID)
}

func (s *service) MoveBlock(userID, blockID string, startRaw string, endRaw *string) (*models.ScheduledBlock, error) {
	block, err := s.blocks.Get(userID, blockID)
	if err != nil {
		return nil, err
	}
	start, err := recurrence.ParseTime(startRaw)
	if err != nil {
		return nil, errors.New("invalid start")
	}
	length := int(block.EndAt.Sub(block.StartAt).Minutes())
	end, err := resolveEnd(start, endRaw, nil, length)
	if err != nil {
		return nil, err
	}
	if err := s.blocks.Move(block, start, end); err != nil {
		return nil, err
	}
	return block, nil
}

func (s *service) DeleteBlock(userID, blockID string) error {
	block, err := s.blocks.Get(userID, blockID)
	if err != nil {
		return err
	}
	return s.blocks.Delete(block)
}

func (s *service) ClearBlocks(userID, taskID string) (*models.Task, error) {
	if _, err := s.tasks.GetTaskByIdForUser(userID, taskID); err != nil {
		return nil, err
	}
	if err := s.blocks.DeleteForTask(taskID, ""); err != nil {
		return nil, err
	}
	return s.tasks.GetTaskByIdForUser(userID, taskID)
}

func resolveEnd(start time.Time, endRaw *string, durationMinutes *int, fallbackMinutes int) (time.Time, error) {
	if endRaw != nil && *endRaw != "" {
		end, err := recurrence.ParseTime(*endRaw)
		if err != nil {
			return time.Time{}, errors.New("invalid end")
		}
		if !end.After(start) {
			return time.Time{}, errors.New("block must end after it starts")
		}
		return end, nil
	}
	minutes := fallbackMinutes
	if durationMinutes != nil && *durationMinutes > 0 {
		minutes = *durationMinutes
	}
	if minutes <= 0 {
		minutes = 30
	}
	return start.Add(time.Duration(minutes) * time.Minute), nil
}

func hasManualBlock(t *models.Task) bool {
	for _, block := range t.Blocks {
		if block.Source == models.BlockSourceManual {
			return true
		}
	}
	return false
}

func lastBlockEnd(t *models.Task) *time.Time {
	var end *time.Time
	for i := range t.Blocks {
		if end == nil || t.Blocks[i].EndAt.After(*end) {
			end = &t.Blocks[i].EndAt
		}
	}
	return end
}

// parseDay reads a date-only or timestamp column as a local calendar day.
func parseDay(value *string, loc *time.Location) *time.Time {
	if value == nil || *value == "" {
		return nil
	}
	parsed, err := recurrence.ParseTimeIn(*value, loc)
	if err != nil {
		return nil
	}
	local := parsed.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	return &day
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *service) FreeTime(userID string, from, to time.Time, timezone string) ([]Interval, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if !to.After(from) {
		return nil, errors.New("`to` must be after `from`")
	}
	hours, err := s.repo.GetWorkingHours(userID)
	if err != nil {
		return nil, err
	}
	loc := time.UTC
	if timezone != "" {
		if parsed, err := time.LoadLocation(timezone); err == nil {
			loc = parsed
		}
	}
	loc = hours.Location(loc)
	if hours.IsEmpty() {
		hours = models.DefaultWorkingHours(loc.String())
	}

	tasks, err := s.tasks.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}
	events, err := s.events.ListInRange(userID, from, to)
	if err != nil {
		return nil, err
	}
	items, err := calendar.Collect(tasks, events, from, to)
	if err != nil {
		return nil, err
	}
	var busy []Interval
	for _, item := range items {
		if item.AllDay {
			continue
		}
		busy = append(busy, Interval{Start: item.Start, End: item.End})
	}
	free := FreeIntervals(from, to, hours, loc, busy)
	if free == nil {
		free = []Interval{}
	}
	return free, nil
}
