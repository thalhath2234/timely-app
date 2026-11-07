package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"timely-api/internal/features/sheet"
	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

// Knowledge is a doc or sheet of the person's that an AI-judged Bot reads
// for its judge, as data (T3): "the most I'll pay" in a wishlist sheet.
const (
	KnowledgeDoc   = "doc"
	KnowledgeSheet = "sheet"

	maxKnowledgeText  = 2000 // runes of the doc or sheet the judge reads
	maxKnowledgeRows  = 100  // sheet rows, after the header
	maxKnowledgeTitle = 120
)

// KnowledgeInput names the doc or sheet a Bot reads.
type KnowledgeInput struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// KnowledgeView is the doc or sheet a Bot reads, by title. Missing is set
// when it was deleted, moved to the bin or is not the person's: the judge
// then runs without it.
type KnowledgeView struct {
	Kind    string `json:"kind"`
	ID      string `json:"id"`
	Title   string `json:"title"`
	Missing bool   `json:"missing"`
}

// errMCPSetup refuses what only the person sets up in Timely: an outside app
// cannot give a Bot knowledge (or, later, links and briefs).
var errMCPSetup = invalid("Judging, knowledge, links and briefs are set up in Timely")

// KnowledgePatch reads a PATCH's "knowledge": absent (nil raw) leaves it,
// null clears it, an object sets it.
func KnowledgePatch(raw json.RawMessage) (in *KnowledgeInput, clear bool, err error) {
	switch strings.TrimSpace(string(raw)) {
	case "":
		return nil, false, nil
	case "null":
		return nil, true, nil
	}
	var k KnowledgeInput
	if err := json.Unmarshal(raw, &k); err != nil {
		return nil, false, invalid("Pick a doc or a sheet")
	}
	return &k, false, nil
}

// knowledgeTable is the table a knowledge kind lives in, or "".
func knowledgeTable(kind string) string {
	switch kind {
	case KnowledgeDoc:
		return "documents"
	case KnowledgeSheet:
		return "sheets"
	}
	return ""
}

// cleanKnowledge checks the doc or sheet a save names: it must be the
// person's and not in the bin. It answers its title too.
func cleanKnowledge(tx *gorm.DB, userID string, in KnowledgeInput) (KnowledgeView, error) {
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	id := strings.TrimSpace(in.ID)
	table := knowledgeTable(kind)
	if table == "" || id == "" {
		return KnowledgeView{}, invalid("Pick a doc or a sheet")
	}
	var rows []struct{ ID, Title string }
	if err := tx.Table(table).Select("id", "title").
		Where("id = ? AND user_id = ? AND archived_at IS NULL", id, userID).Limit(1).Scan(&rows).Error; err != nil {
		return KnowledgeView{}, err
	}
	if len(rows) == 0 {
		return KnowledgeView{}, invalid("That doc or sheet is not in Timely any more")
	}
	return KnowledgeView{Kind: kind, ID: id, Title: cleanLine(rows[0].Title, maxKnowledgeTitle)}, nil
}

// knowledgeViews names the doc or sheet each of the account's Bots reads
// (one Bot when botID is set), by the same test a read makes.
func knowledgeViews(db *gorm.DB, userID, botID string) (map[string]*KnowledgeView, error) {
	var rows []struct {
		BotID, Kind, ID string
		Title           *string
	}
	if err := db.Raw(`
SELECT b.id AS bot_id, b.knowledge_kind AS kind, b.knowledge_id AS id, COALESCE(d.title, s.title) AS title
FROM bots b
LEFT JOIN documents d ON b.knowledge_kind = 'doc' AND d.id = b.knowledge_id AND d.user_id = b.user_id AND d.archived_at IS NULL
LEFT JOIN sheets s ON b.knowledge_kind = 'sheet' AND s.id = b.knowledge_id AND s.user_id = b.user_id AND s.archived_at IS NULL
WHERE b.user_id = ? AND b.knowledge_kind <> '' AND (? = '' OR b.id = ?)`, userID, botID, botID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]*KnowledgeView, len(rows))
	for _, r := range rows {
		v := &KnowledgeView{Kind: r.Kind, ID: r.ID, Missing: r.Title == nil}
		if r.Title != nil {
			v.Title = cleanLine(*r.Title, maxKnowledgeTitle)
		}
		out[r.BotID] = v
	}
	return out, nil
}

// readKnowledge reads the Bot's doc or sheet for its judge, clipped to
// maxKnowledgeText: a doc's words without its properties block, a sheet's
// first tab as tab-separated lines under a header of its column names. The
// row is checked again on every read (knowledge_id has no foreign key); a
// missing, foreign or archived one, or a sheet the engine cannot work out,
// gives nil and the judge runs without it. Outside apps can edit docs and
// sheets, so the judge reads this as data only.
func (s *Service) readKnowledge(ctx context.Context, b Bot) *JudgeKnowledge {
	table := knowledgeTable(b.KnowledgeKind)
	if table == "" || b.KnowledgeID == "" {
		return nil
	}
	if s.knowledgeRead != nil {
		s.knowledgeRead(b)
	}
	db := s.db.WithContext(ctx).Where("id = ? AND user_id = ? AND archived_at IS NULL", b.KnowledgeID, b.UserID)
	var title, text string
	switch b.KnowledgeKind {
	case KnowledgeDoc:
		var d models.Document
		if err := db.Select("id", "title", "content", "plain_text").Take(&d).Error; err != nil {
			knowledgeMiss(b, err)
			return nil
		}
		title, text = d.Title, knowledgeDocText(d)
	case KnowledgeSheet:
		var sh models.Sheet
		if err := db.Select("id", "title", "columns", "rows", "merges", "tabs").Take(&sh).Error; err != nil {
			knowledgeMiss(b, err)
			return nil
		}
		t, err := knowledgeSheetText(&sh)
		if err != nil {
			knowledgeMiss(b, err)
			return nil
		}
		title, text = sh.Title, t
	}
	return &JudgeKnowledge{Kind: b.KnowledgeKind, Title: cleanLine(title, maxKnowledgeTitle), Text: clipRunes(text, maxKnowledgeText)}
}

func knowledgeMiss(b Bot, err error) {
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Printf("bots: knowledge for %s: %v", b.ID, err)
	}
}

// knowledgeDocText is a doc's words without its properties block, as a
// doc's suggestions read it (suggest.docText).
func knowledgeDocText(d models.Document) string {
	text := strings.TrimSpace(d.PlainText)
	if fm := strings.TrimSpace(richtext.Frontmatter(d.Content)); fm != "" {
		text = strings.TrimSpace(strings.TrimPrefix(text, fm))
	}
	return text
}

// knowledgeSheetText works out the sheet's first tab the way the apps show
// it: a header line of column names, then up to maxKnowledgeRows rows that
// hold something, each cell joined by a tab.
func knowledgeSheetText(sh *models.Sheet) (string, error) {
	tabs := sheet.WorkbookTabs(sh)
	if len(tabs) == 0 {
		return "", nil
	}
	values, err := sheet.TabValues(sh, "")
	if err != nil {
		return "", err
	}
	var lines []string
	header := make([]string, len(tabs[0].Columns))
	for i, c := range tabs[0].Columns {
		header[i] = tsvCell(c.Name)
	}
	lines = append(lines, strings.Join(header, "\t"))
	for _, row := range values {
		if len(lines) > maxKnowledgeRows {
			break
		}
		cells := make([]string, len(row))
		empty := true
		for i, v := range row {
			cells[i] = tsvCell(cellText(v))
			empty = empty && cells[i] == ""
		}
		if !empty {
			lines = append(lines, strings.TrimRight(strings.Join(cells, "\t"), "\t"))
		}
	}
	return strings.Join(lines, "\n"), nil
}

// cellText is a worked-out cell as text: empty for nil, the error code for
// an error ("#DIV/0!").
func cellText(v sheet.CellValue) string {
	switch c := v.(type) {
	case nil:
		return ""
	case float64:
		return strconv.FormatFloat(c, 'f', -1, 64)
	case map[string]any:
		if e, ok := c["error"]; ok {
			return fmt.Sprint(e)
		}
	}
	return fmt.Sprint(v)
}

// tsvCell keeps a cell on its line and in its column.
func tsvCell(s string) string {
	return strings.TrimSpace(strings.NewReplacer("\t", " ", "\r\n", " ", "\n", " ", "\r", " ").Replace(s))
}
