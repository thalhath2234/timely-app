package agent

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
	"timely-api/internal/features/doc"
	"timely-api/internal/features/sheet"
	"timely-api/internal/models"
	"timely-api/internal/richtext"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listDocsIn struct {
	WorkspaceID string `json:"workspaceId,omitempty"`
	ProjectID   string `json:"projectId,omitempty"`
	ParentID    string `json:"parentId,omitempty" jsonschema:"use empty omitted; 'root' for top-level"`
	Archived    *bool  `json:"archived,omitempty"`
	Favorite    *bool  `json:"favorite,omitempty"`
	Text        string `json:"text,omitempty"`
}

func (s *Server) listDocs(ctx context.Context, req *mcp.CallToolRequest, in listDocsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	filter := doc.DocumentFilter{
		WorkspaceID: in.WorkspaceID,
		ProjectID:   in.ProjectID,
		Favorite:    in.Favorite,
		Text:        in.Text,
	}
	if in.Archived != nil {
		filter.Archived = in.Archived
	} else {
		filter.Archived = boolPtr(false)
	}
	if in.ParentID == "root" {
		empty := ""
		filter.ParentID = &empty
	} else if in.ParentID != "" {
		filter.ParentID = &in.ParentID
	}
	docs, err := s.Docs.List(uid, filter)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d docs", len(docs)), map[string]any{"docs": docs})
}

type getDocIn struct {
	DocID string `json:"docId"`
	Focus string `json:"focus,omitempty" jsonschema:"what you are looking for in the doc, in a few words; a long doc then shows only the sections about it"`
	Full  bool   `json:"full,omitempty" jsonschema:"true returns the whole doc even with a focus"`
}

func (s *Server) getDoc(ctx context.Context, req *mcp.CallToolRequest, in getDocIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	d, err := s.Docs.GetByID(uid, in.DocID)
	if err != nil {
		return fail(err)
	}
	payload := docPayload(d)
	if !in.Full && in.Focus != "" {
		markdown, _ := payload["markdown"].(string)
		if trimmed, hidden, total, ok := focusPassages(ctx, s.Decisions, uid, d.ID, d.Title, in.Focus, markdown); ok {
			payload["markdown"] = trimmed
			// The search copy holds every section in full.
			delete(payload, "plainText")
			payload["sectionsKeptOut"] = fmt.Sprintf("%d of %d sections are not about %q and show as a [section kept out ...] line. Call get_doc with full=true to read them. Writing such a line back exactly as shown, alone on its line, keeps that section unchanged; deleting it removes the section", hidden, total, clipRunes(in.Focus, 80))
		}
	}
	return reply(d.Title, payload)
}

type createDocIn struct {
	Title       string `json:"title"`
	Markdown    string `json:"markdown,omitempty"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	ProjectID   string `json:"projectId,omitempty"`
	ParentID    string `json:"parentId,omitempty"`
	Icon        string `json:"icon,omitempty"`
}

func (s *Server) createDoc(ctx context.Context, req *mcp.CallToolRequest, in createDocIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	d := &models.Document{
		Title:       in.Title,
		UserID:      uid,
		WorkspaceID: in.WorkspaceID,
		ProjectID:   strPtr(in.ProjectID),
		ParentID:    strPtr(in.ParentID),
		Icon:        strPtr(in.Icon),
	}
	if in.Markdown != "" {
		rich, plain, err := s.docMarkdown(uid, in.Markdown)
		if err != nil {
			return fail(err)
		}
		d.Content = rich
		d.PlainText = plain
	}
	created, err := s.Docs.Create(d)
	if err != nil {
		return fail(err)
	}
	return reply("created "+created.Title, docPayload(created))
}

type updateDocIn struct {
	DocID      string  `json:"docId"`
	Title      *string `json:"title,omitempty"`
	Markdown   *string `json:"markdown,omitempty"`
	Icon       *string `json:"icon,omitempty"`
	ParentID   *string `json:"parentId,omitempty"`
	ProjectID  *string `json:"projectId,omitempty"`
	IsFavorite *bool   `json:"isFavorite,omitempty"`
	Archived   *bool   `json:"archived,omitempty"`
	Order      *int    `json:"order,omitempty"`
}

func (s *Server) updateDoc(ctx context.Context, req *mcp.CallToolRequest, in updateDocIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	update := doc.DocumentUpdate{
		Title:      in.Title,
		Icon:       in.Icon,
		ParentID:   in.ParentID,
		ProjectID:  in.ProjectID,
		IsFavorite: in.IsFavorite,
		Archived:   in.Archived,
		Order:      in.Order,
	}
	if in.Markdown != nil {
		rich, plain, err := s.docMarkdown(uid, *in.Markdown)
		if err != nil {
			return fail(err)
		}
		update.Content = &rich
		update.PlainText = &plain
		update.Snapshot = true
	}
	d, err := s.Docs.Update(uid, in.DocID, update)
	if err != nil {
		return fail(err)
	}
	return reply("updated "+d.Title, docPayload(d))
}

type appendDocIn struct {
	DocID    string `json:"docId"`
	Markdown string `json:"markdown"`
}

func (s *Server) appendToDoc(ctx context.Context, req *mcp.CallToolRequest, in appendDocIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	current, err := s.Docs.GetByID(uid, in.DocID)
	if err != nil {
		return fail(err)
	}
	// Only the appended text can hold placeholders the model wrote; the
	// doc's own text is kept as it is.
	appended, err := s.docSections(uid, in.Markdown)
	if err != nil {
		return fail(err)
	}
	combined := richtext.ToMarkdown(current.Content)
	if combined != "" && appended != "" {
		combined += "\n\n"
	}
	combined += appended
	rich, plain, err := s.docBlocks(uid, combined)
	if err != nil {
		return fail(err)
	}
	d, err := s.Docs.Update(uid, in.DocID, doc.DocumentUpdate{Content: &rich, PlainText: &plain, Snapshot: true})
	if err != nil {
		return fail(err)
	}
	return reply("appended to "+d.Title, docPayload(d))
}

type archiveDocIn struct {
	DocID    string `json:"docId"`
	Archived *bool  `json:"archived,omitempty" jsonschema:"default true; false unarchives"`
}

func (s *Server) archiveDoc(ctx context.Context, req *mcp.CallToolRequest, in archiveDocIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	archived := true
	if in.Archived != nil {
		archived = *in.Archived
	}
	d, err := s.Docs.Update(uid, in.DocID, doc.DocumentUpdate{Archived: &archived})
	if err != nil {
		return fail(err)
	}
	verb := "archived"
	if !archived {
		verb = "unarchived"
	}
	return reply(verb+" "+d.Title, docPayload(d))
}

type deleteDocIn struct {
	DocID   string `json:"docId"`
	Confirm bool   `json:"confirm"`
}

func (s *Server) deleteDoc(ctx context.Context, req *mcp.CallToolRequest, in deleteDocIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	docs, err := s.Docs.List(uid, doc.DocumentFilter{})
	if err != nil {
		return fail(err)
	}
	descendants := countDocDescendants(docs, in.DocID)
	action := "delete this document"
	if descendants > 0 {
		action = fmt.Sprintf("delete this document (%d subpages are not deleted automatically)", descendants)
	}
	if err := confirmOrFail(in.Confirm, action); err != nil {
		return fail(err)
	}
	if err := s.Docs.Delete(uid, in.DocID); err != nil {
		return fail(err)
	}
	return reply("document deleted", map[string]any{"id": in.DocID, "descendantCount": descendants})
}

func countDocDescendants(docs []models.Document, rootID string) int {
	children := map[string][]string{}
	for _, d := range docs {
		if d.ParentID != nil && *d.ParentID != "" {
			children[*d.ParentID] = append(children[*d.ParentID], d.ID)
		}
	}
	count := 0
	var walk func(id string)
	walk = func(id string) {
		for _, child := range children[id] {
			count++
			walk(child)
		}
	}
	walk(rootID)
	return count
}

type listSheetsIn struct {
	WorkspaceID string `json:"workspaceId,omitempty"`
	ProjectID   string `json:"projectId,omitempty"`
	Archived    *bool  `json:"archived,omitempty"`
	Favorite    *bool  `json:"favorite,omitempty"`
	Text        string `json:"text,omitempty"`
}

func (s *Server) listSheets(ctx context.Context, req *mcp.CallToolRequest, in listSheetsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	filter := sheet.SheetFilter{
		WorkspaceID: in.WorkspaceID,
		ProjectID:   in.ProjectID,
		Favorite:    in.Favorite,
		Text:        in.Text,
	}
	if in.Archived != nil {
		filter.Archived = in.Archived
	} else {
		filter.Archived = boolPtr(false)
	}
	sheets, err := s.Sheets.List(uid, filter)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d sheets", len(sheets)), map[string]any{"sheets": sheets})
}

type sheetIDIn struct {
	SheetID string `json:"sheetId"`
}

func (s *Server) getSheet(ctx context.Context, req *mcp.CallToolRequest, in sheetIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.GetByID(uid, in.SheetID)
	if err != nil {
		return fail(err)
	}
	return reply(sh.Title, sheetPayload(sh))
}

type createSheetIn struct {
	Title       string  `json:"title"`
	WorkspaceID string  `json:"workspaceId,omitempty"`
	ProjectID   string  `json:"projectId,omitempty"`
	Icon        string  `json:"icon,omitempty"`
	TemplateID  string  `json:"templateId,omitempty" jsonschema:"create from a sheet template (list_sheet_templates); a builtin: id such as builtin:yearly-expenses makes a ready-made workbook"`
	Year        int     `json:"year,omitempty" jsonschema:"built-in templates only: the year in the title; defaults to this year"`
	Currency    string  `json:"currency,omitempty" jsonschema:"built-in templates only: currency for money columns, an ISO code such as LKR or USD, or a symbol"`
	Description *string `json:"description,omitempty" jsonschema:"-"`
}

func (s *Server) createSheet(ctx context.Context, req *mcp.CallToolRequest, in createSheetIn) (*mcp.CallToolResult, any, error) {
	if in.Description != nil {
		return fail(fmt.Errorf("sheet description is no longer supported"))
	}
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if sheet.IsBuiltinTemplate(in.TemplateID) {
		year := in.Year
		if year <= 0 {
			year = time.Now().Year()
		}
		sh, err := sheet.BuildBuiltin(in.TemplateID, year, in.Currency)
		if err != nil {
			return fail(err)
		}
		if title := strings.TrimSpace(in.Title); title != "" {
			sh.Title = title
		}
		sh.UserID, sh.WorkspaceID, sh.ProjectID = uid, in.WorkspaceID, strPtr(in.ProjectID)
		created, err := s.Sheets.Create(sh)
		if err != nil {
			return fail(err)
		}
		return reply("created "+created.Title, sheetPayload(created))
	}
	if in.TemplateID != "" {
		created, err := s.Sheets.CreateFromTemplate(uid, in.TemplateID, in.Title, in.WorkspaceID, strPtr(in.ProjectID))
		if err != nil {
			return fail(err)
		}
		return reply("created "+created.Title, sheetPayload(created))
	}
	sh := &models.Sheet{
		Title:       in.Title,
		UserID:      uid,
		WorkspaceID: in.WorkspaceID,
		ProjectID:   strPtr(in.ProjectID),
		Icon:        strPtr(in.Icon),
	}
	created, err := s.Sheets.Create(sh)
	if err != nil {
		return fail(err)
	}
	return reply("created "+created.Title, sheetPayload(created))
}

type updateSheetIn struct {
	SheetID     string               `json:"sheetId"`
	Title       *string              `json:"title,omitempty"`
	Icon        *string              `json:"icon,omitempty"`
	Description *string              `json:"description,omitempty" jsonschema:"-"`
	Columns     *models.SheetColumns `json:"columns,omitempty"`
	Rows        *models.SheetRows    `json:"rows,omitempty"`
	Merges      *models.SheetMerges  `json:"merges,omitempty"`
	Tabs        *models.SheetTabs    `json:"tabs,omitempty"`
	TabOrder    *[]string            `json:"tabOrder,omitempty" jsonschema:"every tab id in order; with it, tabs lists only the tabs you changed and the others are kept as they are"`
	ProjectID   *string              `json:"projectId,omitempty"`
	IsFavorite  *bool                `json:"isFavorite,omitempty"`
	Archived    *bool                `json:"archived,omitempty"`
}

func (s *Server) updateSheet(ctx context.Context, req *mcp.CallToolRequest, in updateSheetIn) (*mcp.CallToolResult, any, error) {
	if in.Description != nil {
		return fail(fmt.Errorf("sheet description is no longer supported"))
	}
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	update := sheet.SheetUpdate{
		Title:      in.Title,
		Icon:       in.Icon,
		Columns:    in.Columns,
		Rows:       in.Rows,
		Merges:     in.Merges,
		Tabs:       in.Tabs,
		TabOrder:   in.TabOrder,
		ProjectID:  in.ProjectID,
		IsFavorite: in.IsFavorite,
		Archived:   in.Archived,
	}
	sh, err := s.Sheets.Update(uid, in.SheetID, update)
	if err != nil {
		return fail(err)
	}
	return reply("updated "+sh.Title, sheetPayload(sh))
}

type addTabIn struct {
	SheetID string `json:"sheetId"`
	Name    string `json:"name,omitempty" jsonschema:"defaults to Sheet N"`
}

func (s *Server) addSheetTab(ctx context.Context, req *mcp.CallToolRequest, in addTabIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, tab, err := s.Sheets.AddTab(uid, in.SheetID, in.Name)
	if err != nil {
		return fail(err)
	}
	payload := sheetPayload(sh)
	payload["tab"] = tab
	return reply("added tab "+tab.Name, payload)
}

type renameTabIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty renames the first (primary) tab"`
	Name    string `json:"name"`
}

func (s *Server) renameSheetTab(ctx context.Context, req *mcp.CallToolRequest, in renameTabIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.RenameTab(uid, in.SheetID, in.TabID, in.Name)
	if err != nil {
		return fail(err)
	}
	return reply("renamed tab to "+strings.TrimSpace(in.Name), sheetPayload(sh))
}

type deleteTabIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId"`
}

func (s *Server) deleteSheetTab(ctx context.Context, req *mcp.CallToolRequest, in deleteTabIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.DeleteTab(uid, in.SheetID, in.TabID)
	if err != nil {
		return fail(err)
	}
	return reply("deleted tab", sheetPayload(sh))
}

type archiveSheetIn struct {
	SheetID  string `json:"sheetId"`
	Archived *bool  `json:"archived,omitempty" jsonschema:"default true; false unarchives"`
}

func (s *Server) archiveSheet(ctx context.Context, req *mcp.CallToolRequest, in archiveSheetIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	archived := true
	if in.Archived != nil {
		archived = *in.Archived
	}
	sh, err := s.Sheets.Update(uid, in.SheetID, sheet.SheetUpdate{Archived: &archived})
	if err != nil {
		return fail(err)
	}
	verb := "archived"
	if !archived {
		verb = "unarchived"
	}
	return reply(verb+" "+sh.Title, sheetPayload(sh))
}

type addColIn struct {
	SheetID string   `json:"sheetId"`
	TabID   string   `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty means the first tab"`
	Name    string   `json:"name"`
	Type    string   `json:"type,omitempty" jsonschema:"text, number, date, boolean, currency, percent, formula, or select"`
	Options []string `json:"options,omitempty" jsonschema:"dropdown choices for a select column"`
}

func (s *Server) addSheetColumn(ctx context.Context, req *mcp.CallToolRequest, in addColIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.AddColumn(uid, in.SheetID, in.TabID, in.Name, in.Type, in.Options)
	if err != nil {
		return fail(err)
	}
	return reply("added column "+in.Name, sheetPayload(sh))
}

type updateColIn struct {
	SheetID  string                    `json:"sheetId"`
	TabID    string                    `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty means the first tab"`
	ColumnID string                    `json:"columnId"`
	Name     string                    `json:"name,omitempty"`
	Type     string                    `json:"type,omitempty" jsonschema:"text, number, date, boolean, currency, percent, formula, or select"`
	Width    *int                      `json:"width,omitempty"`
	Options  *[]string                 `json:"options,omitempty" jsonschema:"replaces the dropdown choices of a select column; cell values not listed are appended automatically"`
	Format   *models.SheetColumnFormat `json:"format,omitempty" jsonschema:"display format; replaces the old one, {} clears it. currency: ISO code or symbol for money columns; dateFormat: yyyy-mm-dd, d mmm yyyy, d mmm, mmm d, yyyy, dd/mm/yyyy, mm/dd/yyyy, ddd d mmm or mmmm yyyy; decimals: places shown for numbers and money"`
	Hidden   *bool                     `json:"hidden,omitempty" jsonschema:"true hides the column in the grid; false shows it"`
}

func (s *Server) updateSheetColumn(ctx context.Context, req *mcp.CallToolRequest, in updateColIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.UpdateColumn(uid, in.SheetID, in.TabID, in.ColumnID, sheet.ColumnPatch{
		Name:    in.Name,
		Type:    in.Type,
		Width:   in.Width,
		Options: in.Options,
		Format:  in.Format,
		Hidden:  in.Hidden,
	})
	if err != nil {
		return fail(err)
	}
	return reply("updated column", sheetPayload(sh))
}

type deleteColIn struct {
	SheetID  string `json:"sheetId"`
	TabID    string `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty means the first tab"`
	ColumnID string `json:"columnId"`
}

func (s *Server) deleteSheetColumn(ctx context.Context, req *mcp.CallToolRequest, in deleteColIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.DeleteColumn(uid, in.SheetID, in.TabID, in.ColumnID)
	if err != nil {
		return fail(err)
	}
	return reply("column deleted", sheetPayload(sh))
}

type addRowsIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty means the first tab"`
	Count   int    `json:"count,omitempty"`
}

func (s *Server) addSheetRows(ctx context.Context, req *mcp.CallToolRequest, in addRowsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	count := in.Count
	if count <= 0 {
		count = 1
	}
	sh, err := s.Sheets.AddRows(uid, in.SheetID, in.TabID, count)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("added %d rows", count), sheetPayload(sh))
}

type updateCellsIn struct {
	SheetID string            `json:"sheetId"`
	TabID   string            `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty means the first tab"`
	RowID   string            `json:"rowId"`
	Cells   map[string]string `json:"cells" jsonschema:"Map column IDs to literal values or formulas, e.g. =B5+SUM(N2:N). Supports N:N whole columns, 2:2 whole rows, and N2:N or B2:2 open ranges. Get row and column IDs with get_sheet; do not use A1 addresses as map keys."`
}

func (s *Server) updateSheetCells(ctx context.Context, req *mcp.CallToolRequest, in updateCellsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.UpdateCells(uid, in.SheetID, in.TabID, in.RowID, in.Cells)
	if err != nil {
		return fail(err)
	}
	return reply("cells updated", sheetPayload(sh))
}

type deleteRowsIn struct {
	SheetID string   `json:"sheetId"`
	TabID   string   `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty means the first tab"`
	RowIDs  []string `json:"rowIds"`
}

func (s *Server) deleteSheetRows(ctx context.Context, req *mcp.CallToolRequest, in deleteRowsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.DeleteRows(uid, in.SheetID, in.TabID, in.RowIDs)
	if err != nil {
		return fail(err)
	}
	return reply("rows deleted", sheetPayload(sh))
}

type addRowIn struct {
	SheetID string            `json:"sheetId"`
	TabID   string            `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty means the first tab"`
	Cells   map[string]string `json:"cells" jsonschema:"one entry: column ID or column name to value, e.g. {\"Item\": \"Rice 5kg\", \"Qty\": \"2\"}. Columns left out keep the row's own formulas or stay blank."`
}

// addSheetRow appends one entry the way a person would: into the next free
// row, reusing a template's prepared rows and staying above a totals row.
func (s *Server) addSheetRow(ctx context.Context, req *mcp.CallToolRequest, in addRowIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if len(in.Cells) == 0 {
		return fail(fmt.Errorf("cells is required"))
	}
	current, err := s.Sheets.GetByID(uid, in.SheetID)
	if err != nil {
		return fail(err)
	}
	cells, err := cellsByColumnID(current, in.TabID, in.Cells)
	if err != nil {
		return fail(err)
	}
	sh, index, err := s.Sheets.AddRow(uid, in.SheetID, in.TabID, cells)
	if err != nil {
		return fail(err)
	}
	payload := sheetPayload(sh)
	payload["row"] = index + 1
	return reply(fmt.Sprintf("added an entry in row %d", index+1), payload)
}

// cellsByColumnID lets an agent key cells by column name as well as by id.
func cellsByColumnID(sh *models.Sheet, tabID string, cells map[string]string) (map[string]string, error) {
	columns := sh.Columns
	if len(sh.Tabs) > 0 {
		columns = sh.Tabs[0].Columns
		found := tabID == ""
		for _, tab := range sh.Tabs {
			if tab.ID == tabID {
				columns, found = tab.Columns, true
			}
		}
		if !found {
			return nil, fmt.Errorf("tab not found: %s", tabID)
		}
	}
	byName := make(map[string]string, len(columns))
	ids := make(map[string]bool, len(columns))
	for _, column := range columns {
		ids[column.ID] = true
		byName[strings.ToLower(strings.TrimSpace(column.Name))] = column.ID
	}
	out := make(map[string]string, len(cells))
	for key, value := range cells {
		if ids[key] {
			out[key] = value
			continue
		}
		id, ok := byName[strings.ToLower(strings.TrimSpace(key))]
		if !ok {
			return nil, fmt.Errorf("unknown column: %s", key)
		}
		out[id] = value
	}
	return out, nil
}

type updateTabIn struct {
	SheetID            string         `json:"sheetId"`
	TabID              string         `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty means the first tab"`
	Color              *string        `json:"color,omitempty" jsonschema:"tab colour as #RRGGBB; empty string clears it"`
	FrozenRows         *int           `json:"frozenRows,omitempty" jsonschema:"rows kept at the top while scrolling; 0 unfreezes"`
	FrozenCols         *int           `json:"frozenCols,omitempty" jsonschema:"columns kept at the left while scrolling; 0 unfreezes"`
	ConditionalFormats *[]sheetRuleIn `json:"conditionalFormats,omitempty" jsonschema:"colour rules; replaces the tab's whole list, [] removes them all. Each: columnId, operator (gt, gte, lt, lte, eq, neq, between, contains, notContains, empty, notEmpty, aboveAverage, belowAverage, duplicate), value, value2 (between), fillColor and textColor as #RRGGBB, bold, wholeRow (colour the whole matching row). Frozen rows are never coloured."`
}

// sheetRuleIn is a colour rule as an agent writes it: a new rule has no id yet.
type sheetRuleIn struct {
	ID        string `json:"id,omitempty" jsonschema:"keep the id of an existing rule; leave it out for a new one"`
	ColumnID  string `json:"columnId"`
	Operator  string `json:"operator"`
	Value     string `json:"value,omitempty"`
	Value2    string `json:"value2,omitempty"`
	FillColor string `json:"fillColor,omitempty"`
	TextColor string `json:"textColor,omitempty"`
	Bold      bool   `json:"bold,omitempty"`
	WholeRow  bool   `json:"wholeRow,omitempty"`
}

func (s *Server) updateSheetTab(ctx context.Context, req *mcp.CallToolRequest, in updateTabIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	patch := sheet.TabPatch{Color: in.Color, FrozenRows: in.FrozenRows, FrozenCols: in.FrozenCols}
	if in.ConditionalFormats != nil {
		rules := make([]models.SheetConditionalFormat, len(*in.ConditionalFormats))
		for i, rule := range *in.ConditionalFormats {
			rules[i] = models.SheetConditionalFormat(rule)
		}
		patch.ConditionalFormats = &rules
	}
	sh, err := s.Sheets.UpdateTab(uid, in.SheetID, in.TabID, patch)
	if err != nil {
		return fail(err)
	}
	return reply("tab updated", sheetPayload(sh))
}

func (s *Server) deleteSheet(ctx context.Context, req *mcp.CallToolRequest, in sheetIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if err := s.Sheets.Delete(uid, in.SheetID); err != nil {
		return fail(err)
	}
	return reply("sheet deleted", map[string]string{"id": in.SheetID})
}

func (s *Server) duplicateSheet(ctx context.Context, req *mcp.CallToolRequest, in sheetIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.Duplicate(uid, in.SheetID)
	if err != nil {
		return fail(err)
	}
	return reply("duplicated "+sh.Title, sheetPayload(sh))
}

func (s *Server) listSheetTemplates(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	templates, err := s.Sheets.ListTemplates(uid)
	if err != nil {
		return fail(err)
	}
	builtins, err := sheet.BuiltinTemplates()
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d sheet templates, %d built in", len(templates), len(builtins)), map[string]any{"templates": templates, "builtins": builtins})
}

type templateIDIn struct {
	TemplateID string `json:"templateId"`
}

func (s *Server) getSheetTemplate(ctx context.Context, req *mcp.CallToolRequest, in templateIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	template, err := s.Sheets.GetTemplate(uid, in.TemplateID)
	if err != nil {
		return fail(err)
	}
	return reply(template.Name, template)
}

type createTemplateIn struct {
	SheetID string `json:"sheetId"`
	Name    string `json:"name,omitempty"`
	TabID   string `json:"tabId,omitempty"`
}

func (s *Server) createSheetTemplate(ctx context.Context, req *mcp.CallToolRequest, in createTemplateIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	template, err := s.Sheets.CreateTemplate(uid, in.SheetID, in.Name, in.TabID)
	if err != nil {
		return fail(err)
	}
	return reply("saved template "+template.Name, template)
}

type updateTemplateIn struct {
	TemplateID string `json:"templateId"`
	Name       string `json:"name"`
}

func (s *Server) updateSheetTemplate(ctx context.Context, req *mcp.CallToolRequest, in updateTemplateIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	template, err := s.Sheets.RenameTemplate(uid, in.TemplateID, in.Name)
	if err != nil {
		return fail(err)
	}
	return reply("renamed template "+template.Name, template)
}

func (s *Server) deleteSheetTemplate(ctx context.Context, req *mcp.CallToolRequest, in templateIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if err := s.Sheets.DeleteTemplate(uid, in.TemplateID); err != nil {
		return fail(err)
	}
	return reply("template deleted", map[string]string{"id": in.TemplateID})
}

type materializeTabIn struct {
	TemplateID string `json:"templateId"`
	TabID      string `json:"tabId,omitempty"`
}

func (s *Server) materializeSheetTemplateTab(ctx context.Context, req *mcp.CallToolRequest, in materializeTabIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	tab, err := s.Sheets.MaterializeTemplateTab(uid, in.TemplateID, in.TabID)
	if err != nil {
		return fail(err)
	}
	return reply("materialized tab "+tab.Name, map[string]any{"tab": tab})
}

type sheetValuesIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId,omitempty" jsonschema:"tab id from get_sheet; empty shows every tab, or works the formula out on the first tab"`
	Formula string `json:"formula,omitempty" jsonschema:"work out one formula without saving it, e.g. =SUMIF(C2:C,\"Groceries\",H2:H) or =SUM(January!H2:H); references without a tab read tabId's tab"`
}

// getSheetValues answers questions about a sheet's data with the values the
// apps show. It only reads; get_sheet still returns the raw grid.
func (s *Server) getSheetValues(ctx context.Context, req *mcp.CallToolRequest, in sheetValuesIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.GetByID(uid, in.SheetID)
	if err != nil {
		return fail(err)
	}
	if strings.TrimSpace(in.Formula) != "" {
		value, err := sheet.EvaluateFormula(sh, in.TabID, in.Formula)
		if err != nil {
			return fail(err)
		}
		return reply(in.Formula+" = "+sheetValueText(value), map[string]any{"formula": in.Formula, "value": value})
	}
	values, err := sheet.SheetValues(sh)
	if err != nil {
		return fail(err)
	}
	tabs := sheet.WorkbookTabs(sh)
	var md strings.Builder
	out := make([]map[string]any, 0, len(tabs))
	for t, tab := range tabs {
		if in.TabID != "" && tab.ID != in.TabID {
			continue
		}
		rows := make([]map[string]any, 0)
		fmt.Fprintf(&md, "## %s (tabId %s)\n\n", tab.Name, tab.ID)
		heads := make([]string, len(tab.Columns))
		seps := make([]string, len(tab.Columns))
		for c, column := range tab.Columns {
			heads[c] = strings.ReplaceAll(columnLetters(c)+" "+column.Name+columnUnit(column), "|", "\\|")
			seps[c] = "---"
		}
		fmt.Fprintf(&md, "| # | %s |\n| --- | %s |\n", strings.Join(heads, " | "), strings.Join(seps, " | "))
		for r, row := range tab.Rows {
			if sheet.EmptyEntryRow(row.Cells, r+1) {
				continue
			}
			cells := make([]string, len(tab.Columns))
			byName := make(map[string]any, len(tab.Columns))
			for c, column := range tab.Columns {
				var value sheet.CellValue
				if t < len(values) && r < len(values[t]) && c < len(values[t][r]) {
					value = values[t][r][c]
				}
				cells[c] = strings.ReplaceAll(strings.ReplaceAll(sheetValueText(value), "|", "\\|"), "\n", " ")
				if value != nil && value != "" {
					byName[column.Name] = value
				}
			}
			fmt.Fprintf(&md, "| %d | %s |\n", r+1, strings.Join(cells, " | "))
			rows = append(rows, map[string]any{"row": r + 1, "values": byName})
		}
		md.WriteString("\n")
		out = append(out, map[string]any{"tabId": tab.ID, "name": tab.Name, "rows": rows})
	}
	if in.TabID != "" && len(out) == 0 {
		return fail(fmt.Errorf("tab not found: %s", in.TabID))
	}
	return reply(sh.Title, map[string]any{"sheetId": sh.ID, "title": sh.Title, "markdown": strings.TrimSpace(md.String()), "tabs": out})
}

// columnUnit tells the reader how to read a column's numbers.
func columnUnit(column models.SheetColumn) string {
	switch column.Type {
	case models.SheetColumnTypeCurrency:
		if column.Format != nil && column.Format.Currency != "" {
			return " (" + column.Format.Currency + ")"
		}
		return " (money)"
	case "percent":
		return " (fraction: 0.25 = 25%)"
	}
	return ""
}

func sheetValueText(value sheet.CellValue) string {
	switch v := value.(type) {
	case nil:
		return ""
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		if v {
			return "TRUE"
		}
		return "FALSE"
	case string:
		return v
	case map[string]any:
		if message, ok := v["error"].(string); ok {
			return message
		}
	}
	return fmt.Sprint(value)
}
