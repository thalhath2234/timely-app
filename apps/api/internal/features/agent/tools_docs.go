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
	briefs := make([]map[string]any, len(sheets))
	for i := range sheets {
		briefs[i] = sheetBrief(&sheets[i], false)
	}
	return reply(fmt.Sprintf("%d sheets", len(sheets)), map[string]any{"sheets": briefs})
}

type sheetIDIn struct {
	SheetID string `json:"sheetId"`
}

type getSheetIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId,omitempty" jsonschema:"one tab's grid with row ids: a tab id or the tab's name such as \"October\"; empty shows every tab as markdown with each tab's columns"`
}

// getSheet shows a workbook as markdown with each tab's columns, and one tab
// (the only tab, or tabId) with its raw grid: row ids, formats, colour rules.
// A workbook's rows are not all sent at once; twelve month tabs of prepared
// rows would not fit an agent's context.
func (s *Server) getSheet(ctx context.Context, req *mcp.CallToolRequest, in getSheetIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.GetByID(uid, in.SheetID)
	if err != nil {
		return fail(err)
	}
	payload := map[string]any{"sheet": sheetBrief(sh, true)}
	if strings.TrimSpace(in.TabID) == "" && len(sh.Tabs) > 1 {
		payload["markdown"] = workbookMarkdown(sh)
		payload["note"] = "Rows are shown as markdown; row numbers there are what update_sheet_cells row and delete_sheet_rows rows take. get_sheet with tabId returns that tab's raw grid with row ids. update_sheet replaces whole arrays, so read a tab before rewriting it."
		return reply(sh.Title, payload)
	}
	tabID, err := pickTab(sh, in.TabID)
	if err != nil {
		return fail(err)
	}
	tab, _ := tabByID(sh, tabID)
	payload["sheet"] = sheetBrief(sh, false)
	if len(sh.Tabs) == 0 {
		tab.ID = ""
		payload["markdown"] = sheetMarkdown(sh)
	} else {
		payload["markdown"] = tabMarkdown(tab)
	}
	payload["tab"] = leanTab(tab)
	return reply(sh.Title+" · "+tab.Name, payload)
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
		return reply("created "+created.Title, sheetResult(created, ""))
	}
	if in.TemplateID != "" {
		created, err := s.Sheets.CreateFromTemplate(uid, in.TemplateID, in.Title, in.WorkspaceID, strPtr(in.ProjectID))
		if err != nil {
			return fail(err)
		}
		return reply("created "+created.Title, sheetResult(created, ""))
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
	return reply("created "+created.Title, sheetResult(created, ""))
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
	return reply("updated "+sh.Title, sheetResult(sh, ""))
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
	return reply("added tab "+tab.Name, sheetResult(sh, tab.ID))
}

type renameTabIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId,omitempty" jsonschema:"tab id from get_sheet or the tab's current name; empty renames the first (primary) tab"`
	Name    string `json:"name"`
}

func (s *Server) renameSheetTab(ctx context.Context, req *mcp.CallToolRequest, in renameTabIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	tabID := ""
	if strings.TrimSpace(in.TabID) != "" {
		if _, tabID, err = s.sheetTab(uid, in.SheetID, in.TabID); err != nil {
			return fail(err)
		}
	}
	sh, err := s.Sheets.RenameTab(uid, in.SheetID, tabID, in.Name)
	if err != nil {
		return fail(err)
	}
	return reply("renamed tab to "+strings.TrimSpace(in.Name), sheetResult(sh, tabID))
}

type deleteTabIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId" jsonschema:"tab id from get_sheet or the tab's name"`
}

func (s *Server) deleteSheetTab(ctx context.Context, req *mcp.CallToolRequest, in deleteTabIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if strings.TrimSpace(in.TabID) == "" {
		return fail(fmt.Errorf("tabId is required"))
	}
	_, tabID, err := s.sheetTab(uid, in.SheetID, in.TabID)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.DeleteTab(uid, in.SheetID, tabID)
	if err != nil {
		return fail(err)
	}
	return reply("deleted tab", sheetResult(sh, ""))
}

// sheetTab loads a sheet and resolves which tab an edit is for (see pickTab).
func (s *Server) sheetTab(uid, sheetID, ref string, owned ...string) (*models.Sheet, string, error) {
	sh, err := s.Sheets.GetByID(uid, sheetID)
	if err != nil {
		return nil, "", err
	}
	tabID, err := pickTab(sh, ref, owned...)
	return sh, tabID, err
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
	return reply(verb+" "+sh.Title, sheetResult(sh, ""))
}

type addColIn struct {
	SheetID string   `json:"sheetId"`
	TabID   string   `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name such as \"October\"; required when the sheet has several tabs"`
	Name    string   `json:"name"`
	Type    string   `json:"type,omitempty" jsonschema:"text, number, date, boolean, currency, percent, formula, or select"`
	Options []string `json:"options,omitempty" jsonschema:"dropdown choices for a select column"`
}

func (s *Server) addSheetColumn(ctx context.Context, req *mcp.CallToolRequest, in addColIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	_, tabID, err := s.sheetTab(uid, in.SheetID, in.TabID)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.AddColumn(uid, in.SheetID, tabID, in.Name, in.Type, in.Options)
	if err != nil {
		return fail(err)
	}
	return reply("added column "+in.Name, sheetResult(sh, tabID))
}

type updateColIn struct {
	SheetID  string                    `json:"sheetId"`
	TabID    string                    `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name; found from columnId when left out"`
	ColumnID string                    `json:"columnId" jsonschema:"column id, or the column's name or A1 letter on the tab"`
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
	current, tabID, err := s.sheetTab(uid, in.SheetID, in.TabID, in.ColumnID)
	if err != nil {
		return fail(err)
	}
	columnID, err := columnOn(current, tabID, in.ColumnID)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.UpdateColumn(uid, in.SheetID, tabID, columnID, sheet.ColumnPatch{
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
	return reply("updated column", sheetResult(sh, tabID))
}

type deleteColIn struct {
	SheetID  string `json:"sheetId"`
	TabID    string `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name; found from columnId when left out"`
	ColumnID string `json:"columnId" jsonschema:"column id, or the column's name or A1 letter on the tab"`
}

func (s *Server) deleteSheetColumn(ctx context.Context, req *mcp.CallToolRequest, in deleteColIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	current, tabID, err := s.sheetTab(uid, in.SheetID, in.TabID, in.ColumnID)
	if err != nil {
		return fail(err)
	}
	columnID, err := columnOn(current, tabID, in.ColumnID)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.DeleteColumn(uid, in.SheetID, tabID, columnID)
	if err != nil {
		return fail(err)
	}
	return reply("column deleted", sheetResult(sh, tabID))
}

// columnOn resolves a column id, name or A1 letter on one tab to its id.
func columnOn(sh *models.Sheet, tabID, ref string) (string, error) {
	tab, ok := tabByID(sh, tabID)
	if !ok {
		return "", fmt.Errorf("tab not found: %s", tabID)
	}
	keys, err := columnKeys(tab.Columns, map[string]string{ref: ""})
	if err != nil {
		return "", err
	}
	for id := range keys {
		return id, nil
	}
	return "", fmt.Errorf("unknown column: %s", ref)
}

type addRowsIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name such as \"October\"; required when the sheet has several tabs"`
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
	_, tabID, err := s.sheetTab(uid, in.SheetID, in.TabID)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.AddRows(uid, in.SheetID, tabID, count)
	if err != nil {
		return fail(err)
	}
	payload := sheetResult(sh, tabID)
	if tab, ok := tabByID(sh, tabID); ok {
		first := len(tab.Rows) - count + 1
		payload["rows"] = map[string]int{"first": first, "last": len(tab.Rows)}
		return reply(fmt.Sprintf("added %d rows (%d to %d) to %s", count, first, len(tab.Rows), tab.Name), payload)
	}
	return reply(fmt.Sprintf("added %d rows", count), payload)
}

type updateCellsIn struct {
	SheetID string            `json:"sheetId"`
	TabID   string            `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name such as \"October\"; found from rowId when left out"`
	RowID   string            `json:"rowId,omitempty" jsonschema:"row id from get_sheet; or pass row instead"`
	Row     int               `json:"row,omitempty" jsonschema:"row number as get_sheet and get_sheet_values show it (1 is the first row under the headers); instead of rowId"`
	Cells   map[string]string `json:"cells" jsonschema:"column id, column name or A1 column letter to a literal value or a formula, e.g. {\"Unit price\": \"450\"} or {\"H\": \"=E3*G3\"}. Supports N:N whole columns, 2:2 whole rows, and N2:N or B2:2 open ranges in formulas."`
}

func (s *Server) updateSheetCells(ctx context.Context, req *mcp.CallToolRequest, in updateCellsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if in.RowID == "" && in.Row == 0 {
		return fail(fmt.Errorf("pass rowId or row"))
	}
	current, err := s.Sheets.GetByID(uid, in.SheetID)
	if err != nil {
		return fail(err)
	}
	if number, ok := rowNumberRef(current, in.RowID); ok && in.Row == 0 {
		in.Row, in.RowID = number, ""
	}
	tabID, err := pickTab(current, in.TabID, in.RowID)
	if err != nil {
		return fail(err)
	}
	tab, _ := tabByID(current, tabID)
	rowID := in.RowID
	if rowID == "" {
		if rowID, err = rowIDAt(tab, in.Row); err != nil {
			return fail(err)
		}
	}
	cells, err := columnKeys(tab.Columns, in.Cells)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.UpdateCells(uid, in.SheetID, tabID, rowID, cells)
	if err != nil {
		return fail(err)
	}
	payload := sheetResult(sh, tabID)
	if tab, ok := tabByID(sh, tabID); ok {
		for i, row := range tab.Rows {
			if row.ID == rowID {
				payload["row"] = i + 1
				payload["values"] = rowValues(sh, tabID, i)
				return reply(fmt.Sprintf("updated row %d of %s", i+1, tab.Name), payload)
			}
		}
	}
	return reply("cells updated", payload)
}

type deleteRowsIn struct {
	SheetID string   `json:"sheetId"`
	TabID   string   `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name; found from rowIds when left out"`
	RowIDs  []string `json:"rowIds,omitempty" jsonschema:"row ids from get_sheet; or pass rows instead"`
	Rows    []int    `json:"rows,omitempty" jsonschema:"row numbers as get_sheet shows them (1 is the first row under the headers); instead of rowIds"`
}

func (s *Server) deleteSheetRows(ctx context.Context, req *mcp.CallToolRequest, in deleteRowsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if len(in.RowIDs) == 0 && len(in.Rows) == 0 {
		return fail(fmt.Errorf("pass rowIds or rows"))
	}
	current, err := s.Sheets.GetByID(uid, in.SheetID)
	if err != nil {
		return fail(err)
	}
	var ids []string
	for _, id := range in.RowIDs {
		if number, ok := rowNumberRef(current, id); ok {
			in.Rows = append(in.Rows, number)
		} else {
			ids = append(ids, id)
		}
	}
	tabID, err := pickTab(current, in.TabID, ids...)
	if err != nil {
		return fail(err)
	}
	tab, _ := tabByID(current, tabID)
	for _, number := range in.Rows {
		id, err := rowIDAt(tab, number)
		if err != nil {
			return fail(err)
		}
		ids = append(ids, id)
	}
	sh, err := s.Sheets.DeleteRows(uid, in.SheetID, tabID, ids)
	if err != nil {
		return fail(err)
	}
	unique := map[string]bool{}
	for _, id := range ids {
		unique[id] = true
	}
	return reply(fmt.Sprintf("deleted %d rows from %s", len(unique), tab.Name), sheetResult(sh, tabID))
}

type addRowIn struct {
	SheetID string            `json:"sheetId"`
	TabID   string            `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name such as \"October\"; required when the sheet has several tabs"`
	Cells   map[string]string `json:"cells" jsonschema:"one entry: column name, A1 letter or id to value, e.g. {\"Item\": \"Rice 5kg\", \"Qty\": \"2\"}. Columns left out keep the row's own formulas or stay blank."`
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
	keys := make([]string, 0, len(in.Cells))
	for key := range in.Cells {
		keys = append(keys, key)
	}
	current, tabID, err := s.sheetTab(uid, in.SheetID, in.TabID, keys...)
	if err != nil {
		return fail(err)
	}
	tab, _ := tabByID(current, tabID)
	cells, err := columnKeys(tab.Columns, in.Cells)
	if err != nil {
		return fail(err)
	}
	sh, index, err := s.Sheets.AddRow(uid, in.SheetID, tabID, cells)
	if err != nil {
		return fail(err)
	}
	payload := sheetResult(sh, tabID)
	payload["row"] = index + 1
	payload["values"] = rowValues(sh, tabID, index)
	summary := fmt.Sprintf("added an entry to %s, row %d", tab.Name, index+1)
	if warning := monthMismatch(tab, cells); warning != "" {
		payload["warning"] = warning
		summary += ". " + warning
	}
	return reply(summary, payload)
}

// monthMismatch notices an entry dated in another month than the month tab
// it went to, such as a September receipt added to October.
func monthMismatch(tab models.SheetTab, cells map[string]string) string {
	month := -1
	for i := time.January; i <= time.December; i++ {
		if strings.EqualFold(strings.TrimSpace(tab.Name), i.String()) {
			month = int(i)
		}
	}
	if month < 0 {
		return ""
	}
	for _, column := range tab.Columns {
		if column.Type != models.SheetColumnTypeDate {
			continue
		}
		date, err := time.Parse("2006-01-02", models.NormalizeTypedCell(column.Type, cells[column.ID]))
		if err == nil && int(date.Month()) != month {
			return fmt.Sprintf("The %s %s is in %s, not %s; check the tab", column.Name, date.Format("2006-01-02"), date.Month(), tab.Name)
		}
	}
	return ""
}

type updateTabIn struct {
	SheetID            string         `json:"sheetId"`
	TabID              string         `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name such as \"October\"; required when the sheet has several tabs"`
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
	var owned []string
	if in.ConditionalFormats != nil {
		for _, rule := range *in.ConditionalFormats {
			owned = append(owned, rule.ColumnID)
		}
	}
	_, tabID, err := s.sheetTab(uid, in.SheetID, in.TabID, owned...)
	if err != nil {
		return fail(err)
	}
	sh, err := s.Sheets.UpdateTab(uid, in.SheetID, tabID, patch)
	if err != nil {
		return fail(err)
	}
	return reply("tab updated", sheetResult(sh, tabID))
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
	return reply("duplicated "+sh.Title, sheetResult(sh, ""))
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
	if sheet.IsBuiltinTemplate(in.TemplateID) {
		// Built-in templates ship with Timely and are not stored, so a review
		// of create_sheet from one reads it here rather than failing.
		template, err := sheet.Builtin(in.TemplateID)
		if err != nil {
			return fail(err)
		}
		sh := &models.Sheet{ID: template.ID, Title: template.Name, Icon: &template.Icon, Tabs: template.Tabs}
		if len(sh.Tabs) > 0 {
			sh.Columns, sh.Rows, sh.Merges = sh.Tabs[0].Columns, sh.Tabs[0].Rows, sh.Tabs[0].Merges
		}
		payload := map[string]any{
			"id":          template.ID,
			"name":        template.Name,
			"description": template.Description,
			"icon":        template.Icon,
			"builtin":     true,
			"tabs":        sheetBrief(sh, false)["tabs"],
			"markdown":    workbookMarkdown(sh),
		}
		return reply(template.Name, payload)
	}
	template, err := s.Sheets.GetTemplate(uid, in.TemplateID)
	if err != nil {
		return fail(err)
	}
	payload := templateBrief(template)
	payload["markdown"] = workbookMarkdown(templateSheet(template))
	return reply(template.Name, payload)
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
	return reply("saved template "+template.Name, templateBrief(template))
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
	return reply("renamed template "+template.Name, templateBrief(template))
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
	return reply("materialized tab "+tab.Name, map[string]any{"tab": leanTab(tab)})
}

type sheetValuesIn struct {
	SheetID string `json:"sheetId"`
	TabID   string `json:"tabId,omitempty" jsonschema:"tab id from get_sheet, or the tab's name such as \"October\"; empty shows every tab, or works the formula out on the first tab"`
	Formula string `json:"formula,omitempty" jsonschema:"work out one formula without saving it, e.g. =SUMIF(C2:C,\"Groceries\",H2:H) or =SUM(January!H2:H); references without a tab read tabId's tab"`
}

// sheetValuesFor works out the whole workbook, or only tabID and the tabs it
// reads when one tab is asked for, indexed like WorkbookTabs.
func sheetValuesFor(sh *models.Sheet, tabID string) ([][][]sheet.CellValue, error) {
	if tabID == "" {
		return sheet.SheetValues(sh)
	}
	one, err := sheet.TabValues(sh, tabID)
	if err != nil {
		return nil, err
	}
	tabs := sheet.WorkbookTabs(sh)
	values := make([][][]sheet.CellValue, len(tabs))
	for t, tab := range tabs {
		if tab.ID == tabID {
			values[t] = one
		}
	}
	return values, nil
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
	if strings.TrimSpace(in.TabID) != "" {
		if in.TabID, err = pickTab(sh, in.TabID); err != nil {
			return fail(err)
		}
	}
	if strings.TrimSpace(in.Formula) != "" {
		value, err := sheet.EvaluateFormula(sh, in.TabID, in.Formula)
		if err != nil {
			return fail(err)
		}
		return reply(in.Formula+" = "+sheetValueText(value), map[string]any{"formula": in.Formula, "value": value})
	}
	values, err := sheetValuesFor(sh, in.TabID)
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

type docIDIn struct {
	DocID string `json:"docId"`
}

type dailyNoteIn struct {
	Date     string `json:"date,omitempty" jsonschema:"YYYY-MM-DD; defaults to today in the account's timezone"`
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) openDailyNote(ctx context.Context, req *mcp.CallToolRequest, in dailyNoteIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	date := strings.TrimSpace(in.Date)
	if date == "" {
		today, err := s.today(ctx, uid, in.Timezone)
		if err != nil {
			return fail(err)
		}
		date = today.Date()
	}
	d, created, err := s.Docs.Daily(uid, doc.DailyRequest{Date: date})
	if err != nil {
		return fail(err)
	}
	payload := docPayload(d)
	payload["created"] = created
	verb := "opened"
	if created {
		verb = "created"
	}
	return reply(fmt.Sprintf("%s daily note %s", verb, d.Title), payload)
}

func (s *Server) listDocVersions(ctx context.Context, req *mcp.CallToolRequest, in docIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	versions, err := s.Docs.Versions(uid, in.DocID)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d versions", len(versions)), map[string]any{"versions": versions})
}

type restoreDocVersionIn struct {
	DocID     string `json:"docId"`
	VersionID string `json:"versionId"`
}

func (s *Server) restoreDocVersion(ctx context.Context, req *mcp.CallToolRequest, in restoreDocVersionIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	d, err := s.Docs.RestoreVersion(uid, in.DocID, in.VersionID)
	if err != nil {
		return fail(err)
	}
	return reply("restored a version of "+d.Title, docPayload(d))
}

func (s *Server) getDocBacklinks(ctx context.Context, req *mcp.CallToolRequest, in docIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	links, err := s.Docs.Backlinks(uid, in.DocID)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d docs link here", len(links)), map[string]any{"backlinks": links})
}
