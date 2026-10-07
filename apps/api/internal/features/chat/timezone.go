package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"timely-api/internal/features/agent"
	"timely-api/internal/models"
)

const emptyReplyNudge = "System notice (not written by the user): your last reply was empty. Continue the request now: call the read tools you still need, call propose_changes with the complete plan for any change, or reply to the person."

// validTimezone keeps a device zone only when the server can load it.
func validTimezone(name string) string {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 64 {
		return ""
	}
	if _, err := time.LoadLocation(name); err != nil {
		return ""
	}
	return name
}

// zoned resolves the person's timezone the same way ranking and planning do
// (QA-03): saved Working hours, then the device zone sent with the latest
// message, then the server's zone (the desktop app hosts the backend, ADR
// 0011). Tools read it from the context whenever the model omits a timezone;
// with neither saved nor device zone the context carries none, so they fall
// through to the same server-local fallback task.DayLocation uses.
func (s *Service) zoned(ctx context.Context, c *Conversation) (context.Context, *time.Location, string) {
	loc, source, name := time.Local, "default", ""
	var config models.Config
	if s.db != nil {
		_ = s.db.WithContext(ctx).Select("working_hours").Where("user_id = ?", c.UserID).Limit(1).Find(&config).Error
	}
	if saved, err := time.LoadLocation(config.WorkingHours.Timezone); config.WorkingHours.Timezone != "" && err == nil {
		loc, source, name = saved, "saved", saved.String()
	} else if device, err := time.LoadLocation(c.Timezone); c.Timezone != "" && err == nil {
		loc, source, name = device, "device", device.String()
	}
	return agent.WithTimezone(ctx, name), loc, source
}

// timeContext tells the model the person's local date and time and lists the
// coming dates with weekdays, because models miscount weekdays on their own.
func timeContext(now time.Time, loc *time.Location, source string) string {
	local := now.In(loc)
	var b strings.Builder
	fmt.Fprintf(&b, "\nCurrent UTC time: %s.", now.UTC().Format(time.RFC3339))
	switch source {
	case "saved":
		fmt.Fprintf(&b, " The person's timezone is %s (saved in Working hours).", loc)
	case "device":
		fmt.Fprintf(&b, " The person's timezone is %s (from their device; no timezone is saved in Working hours).", loc)
	default:
		fmt.Fprintf(&b, " The person's timezone is unknown, so the server's timezone (%s, UTC%s) is used: say which timezone times are in, and ask which timezone they mean when an exact time matters.", loc, local.Format("-07:00"))
	}
	fmt.Fprintf(&b, " Local now: %s (UTC%s).", local.Format("Monday, 2006-01-02 15:04"), local.Format("-07:00"))
	b.WriteString(" Interpret dates and times the person mentions in this timezone and write timestamps with that date's UTC offset in this timezone. Tool results already show times in this timezone; describe them that way.")
	b.WriteString("\nCalendar (use it for weekdays and relative dates; never work weekdays out yourself): ")
	day := time.Date(local.Year(), local.Month(), local.Day(), 12, 0, 0, 0, loc)
	for i := 0; i < 42; i++ {
		if i > 0 {
			b.WriteString(", ")
		}
		d := day.AddDate(0, 0, i)
		b.WriteString(d.Format("Mon 2006-01-02"))
	}
	monthEnd := time.Date(local.Year(), local.Month()+1, 0, 12, 0, 0, 0, loc)
	fmt.Fprintf(&b, ". The last day of this month is %s.", monthEnd.Format("Monday 2006-01-02"))
	return b.String()
}

// localizeTimes rewrites every RFC 3339 timestamp in a tool result into the
// person's timezone. Stored times otherwise arrive in the API host's zone next
// to UTC ones, and models misread the mixed offsets as different days.
func localizeTimes(value any, loc *time.Location) any {
	encoded, err := json.Marshal(value)
	if err != nil {
		return value
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var generic any
	if err := decoder.Decode(&generic); err != nil {
		return value
	}
	return localizeValue(generic, loc)
}

func localizeValue(value any, loc *time.Location) any {
	switch v := value.(type) {
	case map[string]any:
		for key, item := range v {
			v[key] = localizeValue(item, loc)
		}
		return v
	case []any:
		for i, item := range v {
			v[i] = localizeValue(item, loc)
		}
		return v
	case string:
		if len(v) < 20 || len(v) > 40 || v[10] != 'T' {
			return v
		}
		parsed, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			return v
		}
		// RFC3339Nano keeps the exact instant, so values the model passes back
		// (an occurrence's original start) still match.
		return parsed.In(loc).Format(time.RFC3339Nano)
	default:
		return v
	}
}
