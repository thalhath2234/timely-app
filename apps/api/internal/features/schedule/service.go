package schedule

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
	"timely-api/internal/features/event"
	"timely-api/internal/features/placement"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
	"timely-api/internal/utils"

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
	Start           time.Time  `json:"start"`
	End             time.Time  `json:"end"`
	ChunkIndex      int        `json:"chunkIndex"`
	OccurrenceStart *time.Time `json:"occurrenceStart,omitempty"`
}

type ProposalOut struct {
	TaskID          string     `json:"taskId"`
	TaskName        string     `json:"taskName"`
	Blocks          []BlockOut `json:"blocks"`
	EndsAt          time.Time  `json:"endsAt"`
	Deadline        *time.Time `json:"deadline,omitempty"`
	PastDeadline    bool       `json:"pastDeadline"`
	Reason          string     `json:"reason,omitempty"`
	OccurrenceStart *time.Time `json:"occurrenceStart,omitempty"`
	Change          string     `json:"change,omitempty"`
	// Minutes accounting so a plan can never look complete while leaving
	// work unbooked. Partial is true when ShortfallMinutes > 0.
	RequiredMinutes  int  `json:"requiredMinutes"`
	PlacedMinutes    int  `json:"placedMinutes"`
	ShortfallMinutes int  `json:"shortfallMinutes"`
	Partial          bool `json:"partial"`
}

type PlanChange struct {
	Action   string    `json:"action"`
	TaskID   string    `json:"taskId"`
	TaskName string    `json:"taskName"`
	Message  string    `json:"message"`
	Before   *BlockOut `json:"before,omitempty"`
	After    *BlockOut `json:"after,omitempty"`
}

type PlanRisk struct {
	Kind     string `json:"kind"`
	TaskID   string `json:"taskId,omitempty"`
	TaskName string `json:"taskName,omitempty"`
	Message  string `json:"message"`
}

type DayCapacity struct {
	Date             string `json:"date"`
	AvailableMinutes int    `json:"availableMinutes"`
	ScheduledMinutes int    `json:"scheduledMinutes"`
	PlannedMinutes   int    `json:"plannedMinutes"`
	OverCapacity     bool   `json:"overCapacity"`
	AtRisk           bool   `json:"atRisk"`
}

type PlanResponse struct {
	From           time.Time     `json:"from"`
	To             time.Time     `json:"to"`
	Timezone       string        `json:"timezone"`
	Proposals      []ProposalOut `json:"proposals"`
	Skipped        []Skipped     `json:"skipped"`
	Changes        []PlanChange  `json:"changes"`
	Risks          []PlanRisk    `json:"risks"`
	Capacity       []DayCapacity `json:"capacity"`
	FreeMinutes    int           `json:"freeMinutes"`
	PlannedMinutes int           `json:"plannedMinutes"`
	Applied        bool          `json:"applied"`
	CanUndo        bool          `json:"canUndo"`
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
	GetSettings(userID string) (models.ScheduleSettings, error)
	UpdateSettings(userID string, settings models.ScheduleSettings) (models.ScheduleSettings, error)
	Preview(userID string, req PlanRequest) (*PlanResponse, error)
	Apply(userID string, req PlanRequest) (*PlanResponse, error)
	Undo(userID string) (*PlanResponse, error)
	PreviewUndo(userID string) (*UndoPreview, error)
	Capacity(userID string, from, to time.Time, timezone string) ([]DayCapacity, error)
	PinTask(userID, taskID string, locked bool) (*models.Task, error)
	PinBlock(userID, blockID string, locked bool) (*models.ScheduledBlock, error)
	AddBlock(userID, taskID string, input BlockInput) (*models.Task, error)
	MoveBlock(userID, blockID string, start string, end *string) (*models.ScheduledBlock, error)
	DeleteBlock(userID, blockID string) error
	ClearBlocks(userID, taskID string) (*models.Task, error)
	FreeTime(userID string, from, to time.Time, timezone string) ([]Interval, error)
	Rank(userID string, timezone string) ([]RankedTask, error)
}

type service struct {
	repo      Repository
	tasks     task.TaskRepository
	events    event.EventRepository
	placement *placement.Service
}

func NewService(repo Repository, tasks task.TaskRepository, events event.EventRepository, place *placement.Service) Service {
	return &service{repo: repo, tasks: tasks, events: events, placement: place}
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
	if err := s.placement.RewriteFutureAllDay(userID, hours); err != nil {
		return nil, err
	}
	return &WorkingHoursResponse{WorkingHours: hours}, nil
}

// beforePreview runs ahead of every Preview: smart suggestions use it to read
// and store the traits (urgency, groups) of Work they have not read yet. Apply
// never calls it, so it places exactly what the last Preview ranked.
var beforePreview func(userID string)

// SetBeforePreview installs the hook for every schedule service in the process.
func SetBeforePreview(fn func(userID string)) { beforePreview = fn }

func (s *service) Preview(userID string, req PlanRequest) (*PlanResponse, error) {
	if beforePreview != nil && userID != "" {
		beforePreview(userID)
	}
	plan, _, _, _, err := s.plan(userID, req)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.LatestRevision(userID); err == nil {
		plan.CanUndo = true
	}
	return plan, nil
}

// Apply recomputes and writes engine blocks for every candidate. Candidates
// that no longer fit lose their stale engine blocks so the calendar never
// shows a plan the engine would not produce again. A revision is stored so
// the last apply can be undone. Concurrent applies for one user serialize.
func (s *service) Apply(userID string, req PlanRequest) (*PlanResponse, error) {
	plan, candidateIDs, replaceManual, freezeUntil, err := s.plan(userID, req)
	if err != nil {
		return nil, err
	}

	var next []models.ScheduledBlock
	for _, proposal := range plan.Proposals {
		for _, block := range proposal.Blocks {
			next = append(next, models.ScheduledBlock{
				TaskID:          proposal.TaskID,
				UserID:          userID,
				StartAt:         block.Start,
				EndAt:           block.End,
				Source:          models.BlockSourceEngine,
				ChunkIndex:      block.ChunkIndex,
				OccurrenceStart: proposal.OccurrenceStart,
			})
		}
	}
	err = s.placement.ApplyAutoSchedule(userID, placement.AutoScheduleApply{
		CandidateIDs:     candidateIDs,
		From:             plan.From,
		To:               plan.To,
		FreezeUntil:      freezeUntil,
		ReplaceManualIDs: replaceManual,
		Next:             next,
		Revision: func(replaced []models.ScheduledBlock) (*models.ScheduleRevision, error) {
			raw, err := json.Marshal(revisionSnapshot{Blocks: replaced, TaskIDs: candidateIDs})
			if err != nil {
				return nil, err
			}
			return &models.ScheduleRevision{
				ID:          utils.NewScheduleRevisionID(),
				UserID:      userID,
				CreatedAt:   utils.GetCurrentTimestamp(),
				HorizonFrom: plan.From.UTC().Format(time.RFC3339),
				HorizonTo:   plan.To.UTC().Format(time.RFC3339),
				Snapshot:    raw,
			}, nil
		},
	})
	if err != nil {
		return nil, err
	}
	plan.Applied = true
	plan.CanUndo = true
	return plan, nil
}

// plan gathers availability, busy time and candidates, then runs the engine.
// It returns the candidate ids (whose engine blocks are replaceable) and the
// ids whose manual blocks the caller agreed to replace.
func (s *service) plan(userID string, req PlanRequest) (*PlanResponse, []string, []string, time.Time, error) {
	if userID == "" {
		return nil, nil, nil, time.Time{}, errors.New("user not authenticated")
	}

	hours, err := s.repo.GetWorkingHours(userID)
	if err != nil {
		return nil, nil, nil, time.Time{}, err
	}
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return nil, nil, nil, time.Time{}, err
	}
	settings = settings.Normalized()
	loc := task.DayLocation(hours, req.Timezone)
	if hours.IsEmpty() {
		hours = models.DefaultWorkingHours(models.ZoneName(loc))
	}

	tasks, err := s.tasks.GetAllTaskByUser(userID)
	if err != nil {
		return nil, nil, nil, time.Time{}, err
	}

	from, to, err := s.horizon(req, tasks, loc)
	if err != nil {
		return nil, nil, nil, time.Time{}, err
	}

	events, err := s.events.ListInRange(userID, from, to)
	if err != nil {
		return nil, nil, nil, time.Time{}, err
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
	occCandidates := map[string]bool{}
	var replaceManual []string

	freezeUntil := time.Time{}
	if settings.FreezeHours > 0 {
		freezeUntil = from.Add(time.Duration(settings.FreezeHours) * time.Hour)
		if freezeUntil.After(to) {
			freezeUntil = to
		}
	}

	todayStamp := from.Format("2006-01-02")

	for i := range tasks {
		t := &tasks[i]
		if explicit && !requested[t.ID] {
			continue
		}
		switch {
		case t.IsCompleted():
			if explicit {
				skipped = append(skipped, skip(t.ID, t.Name, ReasonCompleted))
			}
			continue
		case t.IsInbox():
			skipped = append(skipped, skip(t.ID, t.Name, ReasonInbox))
			continue
		case t.IsReminder() && !t.IsRecurring():
			if explicit {
				skipped = append(skipped, skip(t.ID, t.Name, ReasonReminder))
			}
			continue
		}
		if t.WorkspaceID != nil && settings.ExcludesWorkspace(*t.WorkspaceID) {
			skipped = append(skipped, skip(t.ID, t.Name, ReasonWorkspace))
			continue
		}
		if t.ScheduleLocked {
			skipped = append(skipped, skip(t.ID, t.Name, ReasonLocked))
			continue
		}
		if t.IsRecurring() {
			if t.IsReminder() || !t.IsSchedulableWork() {
				if explicit {
					skipped = append(skipped, skip(t.ID, t.Name, ReasonReminder))
				}
				continue
			}
			occs, err := recurrence.Expand(t.Recurrence, time.Duration(t.Duration)*time.Minute, from, to)
			if err != nil {
				return nil, nil, nil, time.Time{}, err
			}
			for _, occ := range occs {
				if occ.CompletedAt != nil {
					continue
				}
				if blockLockedOrFrozen(t, occ.OriginalStart, freezeUntil) {
					skipped = append(skipped, skip(t.ID, t.Name, ReasonFrozen))
					continue
				}
				original := occ.OriginalStart
				cand := s.makeCandidate(t, loc, todayStamp, from)
				cand.ID = occurrenceCandidateID(t.ID, original)
				cand.TaskID = t.ID
				cand.OccurrenceStart = &original
				cand.EarliestStart = maxTimePtr(cand.EarliestStart, &occ.Start)
				cand.Unscheduled = !hasOccurrenceBlock(t, original)
				candidates = append(candidates, cand)
				candidateSet[t.ID] = true
				occCandidates[cand.ID] = true
			}
			continue
		}
		if hasPinnedBlock(t, freezeUntil) && !req.IncludeManual {
			skipped = append(skipped, skip(t.ID, t.Name, ReasonManual))
			continue
		}
		if hasManualBlock(t) && req.IncludeManual {
			replaceManual = append(replaceManual, t.ID)
		}
		if frozenOnly(t, freezeUntil) {
			skipped = append(skipped, skip(t.ID, t.Name, ReasonFrozen))
			continue
		}
		cand := s.makeCandidate(t, loc, todayStamp, from)
		cand.Unscheduled = len(t.Blocks) == 0
		candidates = append(candidates, cand)
		candidateSet[t.ID] = true
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

	occupancy := placement.Busy(tasks, events, from.In(loc), to, hours)
	var busy []Interval
	for _, item := range occupancy {
		if item.Completed {
			continue
		}
		if item.SchedulableWork && candidateSet[item.TaskID] {
			if item.Source == models.BlockSourceEngine || req.IncludeManual {
				if freezeUntil.IsZero() || !item.Start.Before(freezeUntil) {
					continue
				}
			}
		}
		if item.OccurrenceStart != nil && item.SchedulableWork {
			if occCandidates[occurrenceCandidateID(item.TaskID, *item.OccurrenceStart)] {
				if item.Source == models.BlockSourceEngine || req.IncludeManual {
					if freezeUntil.IsZero() || !item.Start.Before(freezeUntil) {
						continue
					}
				}
			}
		}
		busy = append(busy, Interval{Start: item.Start, End: item.End})
	}

	for i := range candidates {
		c := &candidates[i]
		c.Rank = ScoreTask(ScoreInput{
			Priority:      c.Priority,
			Deadline:      c.Deadline,
			Now:           from,
			Blocked:       c.BlockedByID != "" || c.ExternalBlocked,
			Unscheduled:   c.Unscheduled,
			TodayFocus:    c.TodayFocus,
			ActualMinutes: c.ActualMinutes,
			Duration:      c.DurationMinutes,
			Urgency:       c.Urgency,
		})
	}

	result := Plan(PlanInput{
		From:         from,
		To:           to,
		Location:     loc,
		Hours:        hours,
		Busy:         busy,
		Candidates:   candidates,
		BreakMinutes: settings.BreakMinutes,
	})

	response := &PlanResponse{
		From:           from,
		To:             to,
		Timezone:       models.ClientZoneName(loc),
		Proposals:      make([]ProposalOut, 0, len(result.Proposals)),
		Skipped:        append(skipped, result.Skipped...),
		Changes:        []PlanChange{},
		Risks:          []PlanRisk{},
		Capacity:       []DayCapacity{},
		FreeMinutes:    result.FreeMinutes,
		PlannedMinutes: result.PlannedMinutes,
	}
	if response.Skipped == nil {
		response.Skipped = []Skipped{}
	}
	current := currentEngineBlocks(tasks, candidateSet, from, to, freezeUntil)
	for _, proposal := range result.Proposals {
		out := ProposalOut{
			TaskID:           proposal.TaskID,
			TaskName:         proposal.TaskName,
			EndsAt:           proposal.EndsAt,
			Deadline:         proposal.Deadline,
			PastDeadline:     proposal.PastDeadline,
			Reason:           proposal.Reason,
			OccurrenceStart:  proposal.OccurrenceStart,
			Blocks:           make([]BlockOut, 0, len(proposal.Blocks)),
			RequiredMinutes:  proposal.RequiredMinutes,
			PlacedMinutes:    proposal.PlacedMinutes,
			ShortfallMinutes: proposal.ShortfallMinutes,
			Partial:          proposal.ShortfallMinutes > 0,
		}
		if out.Partial {
			response.Risks = append(response.Risks, PlanRisk{
				Kind: "partial_placement", TaskID: proposal.TaskID, TaskName: proposal.TaskName,
				Message: fmt.Sprintf("only %d of %d minutes placed; %d minutes still need a slot",
					proposal.PlacedMinutes, proposal.RequiredMinutes, proposal.ShortfallMinutes),
			})
		}
		for index, block := range proposal.Blocks {
			out.Blocks = append(out.Blocks, BlockOut{
				Start:           block.Start,
				End:             block.End,
				ChunkIndex:      index,
				OccurrenceStart: proposal.OccurrenceStart,
			})
		}
		out.Change = classifyChange(current[proposal.TaskID], out.Blocks)
		response.Proposals = append(response.Proposals, out)
		if proposal.PastDeadline {
			response.Risks = append(response.Risks, PlanRisk{
				Kind: "past_deadline", TaskID: proposal.TaskID, TaskName: proposal.TaskName,
				Message: proposal.TaskName + " finishes after its deadline",
			})
		}
	}
	names := map[string]string{}
	for i := range tasks {
		names[tasks[i].ID] = tasks[i].Name
	}
	response.Changes = diffPlan(current, response.Proposals, skipped, names)
	occupied := make([]Interval, 0, len(occupancy))
	for _, item := range occupancy {
		occupied = append(occupied, Interval{Start: item.Start, End: item.End})
	}
	response.Capacity = dayCapacity(from, to, loc, hours, occupied, response.Proposals)
	if result.FreeMinutes < result.PlannedMinutes {
		response.Risks = append(response.Risks, PlanRisk{
			Kind:    "insufficient_capacity",
			Message: "Planned work uses more minutes than remaining free time",
		})
	}

	candidateIDs := make([]string, 0, len(candidateSet))
	for id := range candidateSet {
		candidateIDs = append(candidateIDs, id)
	}
	return response, candidateIDs, replaceManual, freezeUntil, nil
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
	if t.IsInbox() {
		return nil, errors.New("clarify this inbox item before scheduling")
	}
	if t.IsRecurring() {
		return nil, errors.New("recurring tasks are placed by their recurrence; move an occurrence instead")
	}
	start, err := recurrence.ParseTime(input.Start)
	if err != nil {
		return nil, errors.New("invalid start")
	}
	if t.IsReminder() {
		if err := s.placement.PlacePing(userID, t, start); err != nil {
			return nil, err
		}
		return s.tasks.GetTaskByIdForUser(userID, taskID)
	}
	end, err := placement.ResolveEnd(start, input.End, input.DurationMinutes, t.Duration)
	if err != nil {
		return nil, err
	}
	if err := s.placement.PlaceByHand(userID, t, start, end, input.Replace); err != nil {
		return nil, err
	}
	return s.tasks.GetTaskByIdForUser(userID, taskID)
}

func (s *service) MoveBlock(userID, blockID string, start string, end *string) (*models.ScheduledBlock, error) {
	return s.placement.MoveByHand(userID, blockID, start, end)
}

func (s *service) DeleteBlock(userID, blockID string) error {
	return s.placement.DeleteBlock(userID, blockID)
}

func (s *service) ClearBlocks(userID, taskID string) (*models.Task, error) {
	t, err := s.tasks.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if err := s.placement.ClearTimes(userID, t); err != nil {
		return nil, err
	}
	return s.tasks.GetTaskByIdForUser(userID, taskID)
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

func occurrenceCandidateID(taskID string, original time.Time) string {
	return taskID + "@" + original.UTC().Format(time.RFC3339)
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
	loc := task.DayLocation(hours, timezone)
	if hours.IsEmpty() {
		hours = models.DefaultWorkingHours(models.ZoneName(loc))
	}

	tasks, err := s.tasks.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}
	events, err := s.events.ListInRange(userID, from, to)
	if err != nil {
		return nil, err
	}
	occupancy := placement.Busy(tasks, events, from.In(loc), to, hours)
	var busy []Interval
	for _, item := range occupancy {
		busy = append(busy, Interval{Start: item.Start, End: item.End})
	}
	free := FreeIntervals(from, to, hours, loc, busy)
	if free == nil {
		free = []Interval{}
	}
	return free, nil
}

// Rank lists Unscheduled and Overdue Work for the current date in the Working
// hours timezone (client's timezone, then the server's, when none is saved), the same
// day boundary Auto-schedule plans in (QA-03).
func (s *service) Rank(userID string, timezone string) ([]RankedTask, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	tasks, err := s.tasks.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}
	hours, err := s.repo.GetWorkingHours(userID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	list := RankList(tasks, task.TodayFor(hours, timezone, time.Now()))
	if list == nil {
		list = []RankedTask{}
	}
	return list, nil
}
