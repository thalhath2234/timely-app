package portability

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

func (s *Service) TasksCSV(userID string) ([]byte, error) {
	var tasks []models.Task
	if err := s.db.Where("user_id = ?", userID).Order("created_at, id").Find(&tasks).Error; err != nil {
		return nil, err
	}
	var out bytes.Buffer
	writer := csv.NewWriter(&out)
	_ = writer.Write([]string{"id", "name", "kind", "description", "duration_minutes", "deadline", "start_date", "scheduled_on", "completed_at", "priority", "workspace_id", "project_id", "stage_id", "status_id", "parent_task_id", "blocked_by_id"})
	for _, task := range tasks {
		_ = writer.Write([]string{
			task.ID, task.Name, task.Kind, task.Description, strconv.Itoa(task.Duration),
			stringValue(task.Deadline), stringValue(task.StartDate), stringValue(task.ScheduledOn),
			stringValue(task.CompletedAt), stringValue(task.PriorityLevel), stringValue(task.WorkspaceID),
			stringValue(task.ProjectID), stringValue(task.StageID), stringValue(task.StatusID),
			stringValue(task.ParentTaskID), stringValue(task.BlockedByID),
		})
	}
	writer.Flush()
	return out.Bytes(), writer.Error()
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *Service) CalendarICS(userID string) ([]byte, error) {
	var events []models.Event
	if err := s.db.Where("user_id = ?", userID).Order("start_at").Find(&events).Error; err != nil {
		return nil, err
	}
	var rules []models.RecurrenceRule
	if err := s.db.Where("user_id = ?", userID).Find(&rules).Error; err != nil {
		return nil, err
	}
	ruleByOwner := map[string]models.RecurrenceRule{}
	for _, rule := range rules {
		ruleByOwner[rule.OwnerType+":"+rule.OwnerID] = rule
	}
	type taskBlock struct {
		models.ScheduledBlock
		Name string
	}
	var blocks []taskBlock
	if err := s.db.Table("scheduled_blocks b").
		Select("b.*, t.name").Joins("JOIN tasks t ON t.id = b.task_id").
		Where("b.user_id = ?", userID).Order("b.start_at").Scan(&blocks).Error; err != nil {
		return nil, err
	}

	var out strings.Builder
	out.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Timely//Personal Data Export//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n")
	stamp := icsTime(time.Now().UTC())
	for _, event := range events {
		out.WriteString("BEGIN:VEVENT\r\nUID:" + icsEscape(event.ID) + "@timely\r\nDTSTAMP:" + stamp + "\r\n")
		if event.AllDay {
			out.WriteString("DTSTART;VALUE=DATE:" + event.StartAt.UTC().Format("20060102") + "\r\n")
			out.WriteString("DTEND;VALUE=DATE:" + event.EndAt.UTC().Format("20060102") + "\r\n")
		} else {
			out.WriteString("DTSTART:" + icsTime(event.StartAt) + "\r\nDTEND:" + icsTime(event.EndAt) + "\r\n")
		}
		out.WriteString("SUMMARY:" + icsEscape(event.Title) + "\r\n")
		if event.Description != "" {
			out.WriteString("DESCRIPTION:" + icsEscape(event.Description) + "\r\n")
		}
		if rule, ok := ruleByOwner[models.RecurrenceOwnerEvent+":"+event.ID]; ok && rule.RRule != "" {
			out.WriteString("RRULE:" + strings.TrimPrefix(rule.RRule, "RRULE:") + "\r\n")
		}
		out.WriteString("END:VEVENT\r\n")
	}
	for _, block := range blocks {
		out.WriteString("BEGIN:VEVENT\r\nUID:" + icsEscape(block.ID) + "@timely\r\nDTSTAMP:" + stamp + "\r\n")
		out.WriteString("DTSTART:" + icsTime(block.StartAt) + "\r\nDTEND:" + icsTime(block.EndAt) + "\r\n")
		out.WriteString("SUMMARY:" + icsEscape(block.Name) + "\r\nCATEGORIES:TIMELY-TASK\r\nEND:VEVENT\r\n")
	}
	out.WriteString("END:VCALENDAR\r\n")
	return []byte(out.String()), nil
}

func icsTime(value time.Time) string { return value.UTC().Format("20060102T150405Z") }

func icsEscape(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, ";", "\\;")
	value = strings.ReplaceAll(value, ",", "\\,")
	value = strings.ReplaceAll(value, "\r\n", "\\n")
	return strings.ReplaceAll(value, "\n", "\\n")
}

func (s *Service) DocumentExport(userID, documentID, format string) ([]byte, string, string, error) {
	var document models.Document
	if err := s.db.Where("id = ? AND user_id = ?", documentID, userID).First(&document).Error; err != nil {
		return nil, "", "", err
	}
	markdown := richtext.ToMarkdown(document.Content)
	if markdown == "" {
		markdown = document.PlainText
	}
	base := safeFilename(document.Title)
	switch strings.ToLower(format) {
	case "", "markdown", "md":
		return []byte(markdown + "\n"), base + ".md", "text/markdown; charset=utf-8", nil
	case "pdf":
		return textPDF(document.Title, markdown), base + ".pdf", "application/pdf", nil
	default:
		return nil, "", "", errors.New("format must be markdown or pdf")
	}
}

func safeFilename(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "untitled"
	}
	var out strings.Builder
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == ' ' {
			out.WriteRune(r)
		}
	}
	name := strings.TrimSpace(out.String())
	if name == "" {
		return "untitled"
	}
	if len(name) > 80 {
		name = name[:80]
	}
	return name
}

// textPDF creates a small, dependency-free PDF with selectable text. Markdown
// syntax is retained intentionally so the export remains faithful and readable.
func textPDF(title, body string) []byte {
	lines := wrapPDFText(title, body)
	const perPage = 48
	pages := (len(lines) + perPage - 1) / perPage
	if pages == 0 {
		pages = 1
	}
	type object struct {
		id   int
		body string
	}
	objects := []object{{1, "<< /Type /Catalog /Pages 2 0 R >>"}, {3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"}}
	pageIDs := make([]int, pages)
	for page := 0; page < pages; page++ {
		pageID := 4 + page*2
		contentID := pageID + 1
		pageIDs[page] = pageID
		from := page * perPage
		to := from + perPage
		if to > len(lines) {
			to = len(lines)
		}
		var stream strings.Builder
		stream.WriteString("BT /F1 10 Tf 48 760 Td 14 TL ")
		for _, line := range lines[from:to] {
			stream.WriteString("(" + pdfEscape(line) + ") Tj T* ")
		}
		stream.WriteString("ET")
		content := stream.String()
		objects = append(objects,
			object{pageID, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", contentID)},
			object{contentID, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content)},
		)
	}
	kids := make([]string, len(pageIDs))
	for i, id := range pageIDs {
		kids[i] = fmt.Sprintf("%d 0 R", id)
	}
	objects = append(objects, object{2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), pages)})
	sort.Slice(objects, func(i, j int) bool { return objects[i].id < objects[j].id })
	var pdf bytes.Buffer
	pdf.WriteString("%PDF-1.4\n%Timely\n")
	offsets := make([]int, len(objects)+1)
	for _, obj := range objects {
		offsets[obj.id] = pdf.Len()
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", obj.id, obj.body)
	}
	xref := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for id := 1; id < len(offsets); id++ {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offsets[id])
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	return pdf.Bytes()
}

func wrapPDFText(title, body string) []string {
	input := title + "\n\n" + body
	var out []string
	for _, raw := range strings.Split(strings.ReplaceAll(input, "\r", ""), "\n") {
		line := asciiPDF(raw)
		for len(line) > 88 {
			cut := strings.LastIndex(line[:89], " ")
			if cut < 20 {
				cut = 88
			}
			out = append(out, line[:cut])
			line = strings.TrimSpace(line[cut:])
		}
		out = append(out, line)
	}
	return out
}

func asciiPDF(value string) string {
	var out strings.Builder
	for _, r := range value {
		if r >= 32 && r <= 126 {
			out.WriteRune(r)
		} else {
			out.WriteRune('?')
		}
	}
	return out.String()
}

func pdfEscape(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "(", "\\(")
	return strings.ReplaceAll(value, ")", "\\)")
}
