package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	JobPending   = "pending"
	JobRunning   = "running"
	JobSucceeded = "succeeded"
	JobFailed    = "failed"
	JobCancelled = "cancelled"

	JobSendReminder = "send_reminder"
	JobIndexEntity  = "index_entity"
	JobDailyDigest  = "daily_digest"
	JobOverdueTask  = "overdue_task"
	JobMissedBlock  = "missed_block"
	JobStartSoon    = "start_soon"
	JobSendPush     = "send_push"
	JobCreateBackup = "create_backup"
	JobReindexUser  = "reindex_user"

	NotifyReminder = "reminder"
	NotifyDigest   = "digest"
	NotifyPlanning = "planning"
	NotifyOverdue  = "overdue"
	NotifyMissed   = "missed"
	NotifyStart    = "start"
)

type JobPayload map[string]any

func (p JobPayload) Value() (driver.Value, error) {
	if p == nil {
		return "{}", nil
	}
	b, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (p *JobPayload) Scan(src any) error {
	if src == nil {
		*p = JobPayload{}
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return errors.New("unsupported type for JobPayload scan")
	}
	if len(b) == 0 {
		*p = JobPayload{}
		return nil
	}
	return json.Unmarshal(b, p)
}

func (p JobPayload) String(key string) string {
	if p == nil {
		return ""
	}
	raw, ok := p[key]
	if !ok || raw == nil {
		return ""
	}
	s, _ := raw.(string)
	return s
}

type Job struct {
	ID          string     `gorm:"type:text;primaryKey" json:"id"`
	UserID      string     `gorm:"type:text;not null" json:"userId"`
	Kind        string     `gorm:"type:text;not null" json:"kind"`
	Status      string     `gorm:"type:text;not null;default:pending" json:"status"`
	DedupeKey   *string    `json:"dedupeKey,omitempty"`
	Payload     JobPayload `gorm:"type:jsonb;not null;default:'{}'" json:"payload"`
	RunAt       time.Time  `gorm:"type:timestamptz;not null" json:"runAt"`
	Attempts    int        `gorm:"not null;default:0" json:"attempts"`
	MaxAttempts int        `gorm:"not null;default:8" json:"maxAttempts"`
	LastError   *string    `json:"lastError,omitempty"`
	LockedAt    *time.Time `json:"lockedAt,omitempty"`
	LockedBy    *string    `json:"lockedBy,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
	CreatedAt   time.Time  `gorm:"type:timestamptz;not null" json:"createdAt"`
	UpdatedAt   time.Time  `gorm:"type:timestamptz;not null" json:"updatedAt"`
}

func (Job) TableName() string { return "jobs" }

type Notification struct {
	ID           string     `gorm:"type:text;primaryKey" json:"id"`
	UserID       string     `gorm:"type:text;not null" json:"userId"`
	Category     string     `gorm:"type:text;not null" json:"category"`
	Title        string     `gorm:"type:text;not null" json:"title"`
	Body         string     `gorm:"type:text;not null;default:''" json:"body"`
	EntityType   *string    `json:"entityType,omitempty"`
	EntityID     *string    `json:"entityId,omitempty"`
	Data         JobPayload `gorm:"type:jsonb;not null;default:'{}'" json:"data"`
	DedupeKey    *string    `json:"dedupeKey,omitempty"`
	ReadAt       *time.Time `json:"readAt,omitempty"`
	SnoozedUntil *time.Time `json:"snoozedUntil,omitempty"`
	DeliveredAt  *time.Time `json:"deliveredAt,omitempty"`
	CreatedAt    time.Time  `gorm:"type:timestamptz;not null" json:"createdAt"`
}

func (Notification) TableName() string { return "notifications" }

type PushDevice struct {
	ID         string    `gorm:"type:text;primaryKey" json:"id"`
	UserID     string    `gorm:"type:text;not null" json:"userId"`
	Token      string    `gorm:"type:text;not null" json:"token"`
	Platform   string    `gorm:"type:text;not null;default:android" json:"platform"`
	CreatedAt  time.Time `gorm:"type:timestamptz;not null" json:"createdAt"`
	UpdatedAt  time.Time `gorm:"type:timestamptz;not null" json:"updatedAt"`
	LastSeenAt time.Time `gorm:"type:timestamptz;not null" json:"lastSeenAt"`
}

func (PushDevice) TableName() string { return "push_devices" }

type NotificationSettings struct {
	Reminders       bool   `json:"reminders"`
	DigestMorning   bool   `json:"digestMorning"`
	DigestEvening   bool   `json:"digestEvening"`
	Planning        bool   `json:"planning"`
	QuietHoursStart string `json:"quietHoursStart"`
	QuietHoursEnd   string `json:"quietHoursEnd"`
	Timezone        string `json:"timezone"`
	MorningDigestAt string `json:"morningDigestAt"`
	EveningDigestAt string `json:"eveningDigestAt"`
}

func (s NotificationSettings) Value() (driver.Value, error) {
	b, err := json.Marshal(s.Normalized())
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func defaultNotificationSettings() NotificationSettings {
	return NotificationSettings{
		Reminders:       true,
		DigestMorning:   true,
		DigestEvening:   true,
		Planning:        true,
		MorningDigestAt: "08:00",
		EveningDigestAt: "18:00",
	}
}

func (s *NotificationSettings) Scan(src any) error {
	if src == nil {
		*s = defaultNotificationSettings()
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return errors.New("unsupported type for NotificationSettings scan")
	}
	if len(b) == 0 || strings.TrimSpace(string(b)) == "{}" {
		*s = defaultNotificationSettings()
		return nil
	}
	if err := json.Unmarshal(b, s); err != nil {
		return err
	}
	*s = s.Normalized()
	return nil
}

func (s NotificationSettings) Normalized() NotificationSettings {
	out := s
	if out.MorningDigestAt == "" {
		out.MorningDigestAt = "08:00"
	}
	if out.EveningDigestAt == "" {
		out.EveningDigestAt = "18:00"
	}
	out.QuietHoursStart = normalizeClock(out.QuietHoursStart)
	out.QuietHoursEnd = normalizeClock(out.QuietHoursEnd)
	out.MorningDigestAt = normalizeClock(out.MorningDigestAt)
	out.EveningDigestAt = normalizeClock(out.EveningDigestAt)
	return out
}

func normalizeClock(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) >= 5 && value[2] == ':' {
		return value[:5]
	}
	return value
}

// InQuietHours reports whether local clock falls in the quiet window.
// An empty window means never quiet. Start==End means the whole day is quiet.
func (s NotificationSettings) InQuietHours(now time.Time) bool {
	start := s.QuietHoursStart
	end := s.QuietHoursEnd
	if start == "" || end == "" {
		return false
	}
	mins := now.Hour()*60 + now.Minute()
	from := clockMinutes(start)
	to := clockMinutes(end)
	if from < 0 || to < 0 {
		return false
	}
	if from == to {
		return true
	}
	if from < to {
		return mins >= from && mins < to
	}
	return mins >= from || mins < to
}

// Location is the zone quiet hours and digests are read in: the notification
// zone, then the given Working hours zone, then the server's own zone. The
// desktop app hosts the backend (ADR 0011), so that last zone is the person's
// own; an unknown or invalid name also lands there rather than on UTC.
func (s NotificationSettings) Location(fallback string) *time.Location {
	tz := s.Timezone
	if tz == "" {
		tz = fallback
	}
	if tz != "" {
		if loc, err := time.LoadLocation(tz); err == nil {
			return loc
		}
	}
	return time.Local
}

// ZoneName is the IANA name of Location for a client or a later LoadLocation.
// The server's own zone has none (Go calls it "Local", which nothing else can
// resolve), so it is "" for "unknown, use the server's".
func (s NotificationSettings) ZoneName(fallback string) string {
	loc := s.Location(fallback)
	if loc == time.Local {
		return ""
	}
	return loc.String()
}

func (s NotificationSettings) QuietEnd(now time.Time) time.Time {
	end := clockMinutes(s.QuietHoursEnd)
	if end < 0 {
		return now
	}
	next := time.Date(now.Year(), now.Month(), now.Day(), end/60, end%60, 0, 0, now.Location())
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	return next
}

func clockMinutes(value string) int {
	if len(value) < 5 {
		return -1
	}
	var hours, minutes int
	if _, err := parseClock(value, &hours, &minutes); err != nil {
		return -1
	}
	return hours*60 + minutes
}

func parseClock(value string, hours, minutes *int) (int, error) {
	n, err := parseHHMM(value)
	if err != nil {
		return 0, err
	}
	*hours = n / 60
	*minutes = n % 60
	return n, nil
}

func parseHHMM(value string) (int, error) {
	parts := strings.Split(value, ":")
	if len(parts) < 2 {
		return 0, errors.New("invalid clock")
	}
	h, err := parseSmallInt(parts[0])
	if err != nil || h < 0 || h > 23 {
		return 0, errors.New("invalid clock")
	}
	m, err := parseSmallInt(parts[1])
	if err != nil || m < 0 || m > 59 {
		return 0, errors.New("invalid clock")
	}
	return h*60 + m, nil
}

func parseSmallInt(raw string) (int, error) {
	n := 0
	if raw == "" {
		return 0, errors.New("empty")
	}
	for _, c := range raw {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}
