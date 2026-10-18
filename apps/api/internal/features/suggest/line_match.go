package suggest

import (
	"context"
	"strings"
	"unicode"

	"timely-api/internal/models"
)

// A doc line made into a task is still that task after the person polishes
// it, by hand or with Help me write: "Setup live notifications mobile" and
// "Set up live notifications on the mobile app" are one piece of Work. Lines
// are compared by their words, not their exact text, so a small rewrite does
// not offer the line as a task again.

// minorWords carry no meaning of their own in a to-do; a rewrite adds and
// drops them freely.
var minorWords = map[string]bool{
	"a": true, "an": true, "the": true, "to": true, "for": true, "of": true, "on": true, "in": true,
	"into": true, "and": true, "or": true, "with": true, "at": true, "by": true, "from": true,
	"is": true, "are": true, "be": true, "it": true, "its": true, "this": true, "that": true,
	"these": true, "those": true, "my": true, "our": true, "your": true, "their": true,
	"some": true, "any": true, "all": true, "so": true, "as": true, "also": true, "then": true,
	"just": true, "please": true, "up": true, "about": true,
}

// workWords are a line's meaningful words, lower-cased, in order.
func workWords(line string) []string {
	var out []string
	for _, w := range strings.FieldsFunc(strings.ToLower(line), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if !minorWords[w] {
			out = append(out, w)
		}
	}
	return out
}

// sameWord says whether two words are one word as a rewrite treats it: a
// plural or other ending ("notification", "notifications") or a fixed typo
// ("notifcations").
func sameWord(a, b string) bool {
	if a == b {
		return true
	}
	ra, rb := []rune(a), []rune(b)
	if len(ra) > len(rb) {
		ra, rb = rb, ra
	}
	if len(ra) >= 4 && len(rb)-len(ra) <= 3 && string(rb[:len(ra)]) == string(ra) {
		return true
	}
	return len(ra) >= 5 && len(rb)-len(ra) <= 1 && editDistance(string(ra), string(rb)) <= 1
}

// sameWork says whether two lines name one piece of Work: most of the
// shorter line's words are in the longer one, and the longer one is not
// mostly about something else. A line known to have come from this doc (a
// task or dismissal made from it) may drift further than a task that only
// happens to share words with it. Two words that differ ("Call mom", "Call
// dad") are never the same Work.
func sameWork(a, b string, fromDoc bool) bool {
	wa, wb := workWords(a), workWords(b)
	if len(wa) == 0 || len(wb) == 0 {
		return false
	}
	if len(wa) > len(wb) {
		wa, wb = wb, wa
	}
	used := make([]bool, len(wb))
	matched := 0
	for _, w := range wa {
		for j, v := range wb {
			if !used[j] && sameWord(w, v) {
				used[j] = true
				matched++
				break
			}
		}
	}
	share := 0.75
	if fromDoc {
		share = 0.6
	}
	need := int(share*float64(len(wa)) + 0.999)
	if len(wa) >= 2 && need < 2 {
		need = 2
	}
	return matched >= need && float64(matched) >= float64(len(wb))/3
}

// madeLine is a task that may have come from a line of the doc: its name and,
// when it links the doc, the line it quotes.
type madeLine struct {
	id      string
	name    string
	quote   string
	fromDoc bool
}

// madeSinceDoc are the person's tasks made since the doc was, open or done,
// newest first: a line edited after it became one of them is matched to it
// by sameWork. A task whose description links the doc came from it. With
// sameWorkspace, tasks in the doc's workspace that do not link it count too:
// a line made a task before tasks linked their doc has only its name.
func (s *Service) madeSinceDoc(ctx context.Context, userID string, doc models.Document, sameWorkspace bool) []madeLine {
	since := doc.CreatedAt
	if len(since) > 10 {
		since = since[:10]
	}
	var rows []struct {
		ID          string
		Name        string
		Description string
		Linked      bool
	}
	link := "%" + likeEscape(doc.ID) + "%"
	q := s.db.WithContext(ctx).Model(&models.Task{}).
		Select("id, name, description, description_rich::text LIKE ? AS linked", link).
		Where("user_id = ? AND created_at >= ?", userID, since)
	if sameWorkspace {
		q = q.Where("workspace_id = ? OR description_rich::text LIKE ?", doc.WorkspaceID, link)
	} else {
		q = q.Where("description_rich::text LIKE ?", link)
	}
	q.Order("completed_at IS NOT NULL, created_at DESC").Limit(500).Scan(&rows)
	out := make([]madeLine, 0, len(rows))
	for _, r := range rows {
		m := madeLine{id: r.ID, name: r.Name, fromDoc: r.Linked}
		if r.Linked {
			m.quote = quotedItem(r.Description)
		}
		out = append(out, m)
	}
	return out
}

// matches says whether the line is this task's Work, by its name or the line
// it quotes.
func (m madeLine) matches(line string) bool {
	return sameWork(line, m.name, m.fromDoc) || (m.quote != "" && sameWork(line, m.quote, true))
}

// quotedItem is the line a task description quotes after its doc link
// (`From <doc>: “<item>”`, checklistTaskDescription in the contract).
func quotedItem(description string) string {
	i := strings.LastIndex(description, ": “")
	if i < 0 {
		return ""
	}
	rest := description[i+len(": “"):]
	if j := strings.LastIndex(rest, "”"); j >= 0 {
		rest = rest[:j]
	}
	return strings.TrimSpace(rest)
}
