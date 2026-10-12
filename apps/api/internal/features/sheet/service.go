package sheet

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"timely-api/internal/features/embed"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

const (
	maxTitleLength = 200
	maxColumns     = 100
	maxRows        = 5000
	maxCellLength  = 5000
	defaultRows    = 20
)

// SheetUpdate carries only the fields a client may change. Nil means
// "leave untouched" so autosave can send partial payloads.
type SheetUpdate struct {
	Title   *string
	Icon    *string
	Columns *models.SheetColumns
	Rows    *models.SheetRows
	Merges  *models.SheetMerges
	Tabs    *models.SheetTabs
	// TabOrder, when set, makes Tabs a partial list: only the tabs that changed.
	// The saved workbook keeps every other tab as it is on the server, in this
	// order, and drops tabs whose ids are missing. Two devices editing different
	// tabs then never overwrite each other.
	TabOrder   *[]string
	ProjectID  *string
	IsFavorite *bool
	Archived   *bool
}

// TemplateUpdate is SheetUpdate for templates: nil leaves a field untouched.
type TemplateUpdate struct {
	Name    *string
	Icon    *string
	Columns *models.SheetColumns
	Rows    *models.SheetRows
	Merges  *models.SheetMerges
	Tabs    *models.SheetTabs
}

type SheetFilter struct {
	WorkspaceID string
	ProjectID   string
	Archived    *bool
	Favorite    *bool
	Text        string
}

type SheetService interface {
	Create(sheet *models.Sheet) (*models.Sheet, error)
	CreateFromTemplate(userID, templateID, title, workspaceID string, projectID *string) (*models.Sheet, error)
	GetAllByUser(userID string) ([]models.Sheet, error)
	List(userID string, filter SheetFilter) ([]models.Sheet, error)
	GetByID(userID string, sheetID string) (*models.Sheet, error)
	Update(userID string, sheetID string, update SheetUpdate) (*models.Sheet, error)
	Duplicate(userID, sheetID string) (*models.Sheet, error)
	Delete(userID string, sheetID string) error
	// The grid edits below take a tab id; an empty id is the first tab.
	AddRows(userID, sheetID, tabID string, count int) (*models.Sheet, error)
	AddRow(userID, sheetID, tabID string, cells map[string]string) (*models.Sheet, int, error)
	UpdateCells(userID, sheetID, tabID, rowID string, cells map[string]string) (*models.Sheet, error)
	DeleteRows(userID, sheetID, tabID string, rowIDs []string) (*models.Sheet, error)
	AddColumn(userID, sheetID, tabID, name, colType string, options []string) (*models.Sheet, error)
	UpdateColumn(userID, sheetID, tabID, columnID string, patch ColumnPatch) (*models.Sheet, error)
	DeleteColumn(userID, sheetID, tabID, columnID string) (*models.Sheet, error)
	UpdateTab(userID, sheetID, tabID string, patch TabPatch) (*models.Sheet, error)
	AddTab(userID, sheetID, name string) (*models.Sheet, models.SheetTab, error)
	RenameTab(userID, sheetID, tabID, name string) (*models.Sheet, error)
	DeleteTab(userID, sheetID, tabID string) (*models.Sheet, error)

	ListTemplates(userID string) ([]models.SheetTemplate, error)
	GetTemplate(userID, templateID string) (*models.SheetTemplate, error)
	CreateTemplate(userID, sheetID, name, tabID string) (*models.SheetTemplate, error)
	RenameTemplate(userID, templateID, name string) (*models.SheetTemplate, error)
	UpdateTemplate(userID, templateID string, update TemplateUpdate) (*models.SheetTemplate, error)
	DeleteTemplate(userID, templateID string) error
	MaterializeTemplateTab(userID, templateID, tabID string) (models.SheetTab, error)
}

type sheetService struct {
	repo    SheetRepository
	indexer embed.Indexer
	// gridLocks holds one mutex per sheet so two saves of different tabs
	// (laptop and phone at once) both land instead of the later one
	// overwriting the tab the other just changed.
	gridLocks sync.Map
}

func (s *sheetService) lockGrid(sheetID string) func() {
	value, _ := s.gridLocks.LoadOrStore(sheetID, &sync.Mutex{})
	mu := value.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

func NewSheetService(repo SheetRepository, indexer embed.Indexer) SheetService {
	return &sheetService{repo: repo, indexer: indexer}
}

func (s *sheetService) Create(sheet *models.Sheet) (*models.Sheet, error) {
	if sheet.UserID == "" {
		return nil, errors.New("user not authenticated")
	}

	sheet.Title = normalizeTitle(sheet.Title)

	if sheet.WorkspaceID == "" {
		workspaceID, err := s.repo.DefaultWorkspaceID(sheet.UserID)
		if err != nil {
			return nil, errors.New("no workspace available for this user")
		}
		sheet.WorkspaceID = workspaceID
	} else {
		owned, err := s.repo.WorkspaceBelongsToUser(sheet.UserID, sheet.WorkspaceID)
		if err != nil {
			return nil, err
		}
		if !owned {
			return nil, errors.New("workspace not found")
		}
	}
	if sheet.ProjectID != nil && *sheet.ProjectID != "" {
		if err := s.assertProject(sheet.UserID, *sheet.ProjectID); err != nil {
			return nil, err
		}
	}

	if len(sheet.Columns) == 0 && len(sheet.Tabs) == 0 {
		sheet.Columns = models.DefaultSheetColumns()
		sheet.Rows = models.DefaultSheetRows(sheet.Columns, defaultRows)
	}

	if err := prepareGrid(sheet.Title, &sheet.Columns, &sheet.Rows, &sheet.Merges, &sheet.Tabs); err != nil {
		return nil, err
	}

	sheet.ID = utils.NewSheetID()

	created, err := s.repo.CreateSheet(sheet)
	if err != nil {
		return nil, err
	}
	s.indexSheet(created)
	return created, nil
}

func (s *sheetService) GetAllByUser(userID string) ([]models.Sheet, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}

	return s.repo.GetAllSheetsByUser(userID)
}

func (s *sheetService) List(userID string, filter SheetFilter) ([]models.Sheet, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	return s.repo.ListSheets(userID, filter)
}

func (s *sheetService) GetByID(userID string, sheetID string) (*models.Sheet, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if sheetID == "" {
		return nil, errors.New("invalid sheet id")
	}

	return s.repo.GetSheetByID(userID, sheetID)
}

func (s *sheetService) Update(userID string, sheetID string, update SheetUpdate) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	return s.update(userID, sheetID, update)
}

// update applies a change; the caller holds the sheet's grid lock.
func (s *sheetService) update(userID string, sheetID string, update SheetUpdate) (*models.Sheet, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if sheetID == "" {
		return nil, errors.New("invalid sheet id")
	}

	updates := map[string]any{}

	if update.Title != nil {
		updates["title"] = normalizeTitle(*update.Title)
	}
	if update.Icon != nil {
		updates["icon"] = *update.Icon
	}
	if update.ProjectID != nil {
		if *update.ProjectID == "" {
			updates["project_id"] = nil
		} else {
			if err := s.assertProject(userID, *update.ProjectID); err != nil {
				return nil, err
			}
			updates["project_id"] = *update.ProjectID
		}
	}
	if update.IsFavorite != nil {
		updates["is_favorite"] = *update.IsFavorite
	}
	if update.Archived != nil {
		if *update.Archived {
			updates["archived_at"] = utils.GetCurrentTimestamp()
		} else {
			updates["archived_at"] = nil
		}
	}

	grid := gridUpdate{Columns: update.Columns, Rows: update.Rows, Merges: update.Merges, Tabs: update.Tabs}
	if grid.changed() || update.TabOrder != nil {
		current, err := s.repo.GetSheetByID(userID, sheetID)
		if err != nil {
			return nil, err
		}
		if update.TabOrder != nil {
			merged, err := mergeTabs(workbookTabs(current), update.Tabs, *update.TabOrder)
			if err != nil {
				return nil, err
			}
			grid.Tabs = &merged
			// The primary grid follows the first tab of the merged workbook.
			grid.Columns, grid.Rows, grid.Merges = nil, nil, nil
		}
		if err := grid.apply(current.Title, current.Columns, current.Rows, current.Merges, current.Tabs, updates); err != nil {
			return nil, err
		}
	}

	if len(updates) > 0 {
		updates["updated_at"] = utils.GetCurrentTimestamp()
	}

	sheet, err := s.repo.UpdateSheet(userID, sheetID, updates)
	if err != nil {
		return nil, err
	}
	s.indexSheet(sheet)
	return sheet, nil
}

func (s *sheetService) Duplicate(userID, sheetID string) (*models.Sheet, error) {
	src, err := s.GetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}

	columns, rows, merges, tabs := models.CloneSheetContents(src)
	clone := &models.Sheet{
		Title:       "Copy of " + src.Title,
		Icon:        src.Icon,
		Columns:     columns,
		Rows:        rows,
		Merges:      merges,
		Tabs:        tabs,
		WorkspaceID: src.WorkspaceID,
		ProjectID:   src.ProjectID,
		UserID:      userID,
	}
	return s.Create(clone)
}

const maxTemplates = 50

func (s *sheetService) CreateFromTemplate(userID, templateID, title, workspaceID string, projectID *string) (*models.Sheet, error) {
	template, err := s.GetTemplate(userID, templateID)
	if err != nil {
		return nil, err
	}
	columns, rows, merges, tabs := models.CloneTemplateContents(template)
	name := strings.TrimSpace(title)
	if name == "" {
		name = template.Name
	}
	return s.Create(&models.Sheet{
		Title:       name,
		Icon:        template.Icon,
		Columns:     columns,
		Rows:        rows,
		Merges:      merges,
		Tabs:        tabs,
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
		UserID:      userID,
	})
}

func (s *sheetService) ListTemplates(userID string) ([]models.SheetTemplate, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	return s.repo.ListTemplates(userID)
}

func (s *sheetService) GetTemplate(userID, templateID string) (*models.SheetTemplate, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if templateID == "" {
		return nil, errors.New("invalid template id")
	}
	return s.repo.GetTemplateByID(userID, templateID)
}

func (s *sheetService) CreateTemplate(userID, sheetID, name, tabID string) (*models.SheetTemplate, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	count, err := s.repo.CountTemplates(userID)
	if err != nil {
		return nil, err
	}
	if count >= maxTemplates {
		return nil, errors.New("too many templates")
	}

	src, err := s.GetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}

	columns, rows, merges, tabs, err := models.SnapshotSheet(src, tabID)
	if err != nil {
		return nil, err
	}

	title := normalizeTitle(name)
	if strings.TrimSpace(name) == "" {
		title = normalizeTitle(src.Title)
	}

	template := &models.SheetTemplate{
		ID:            utils.NewSheetTemplateID(),
		UserID:        userID,
		Name:          title,
		Icon:          src.Icon,
		Columns:       columns,
		Rows:          rows,
		Merges:        merges,
		Tabs:          tabs,
		SourceSheetID: &src.ID,
	}
	return s.repo.CreateTemplate(template)
}

func (s *sheetService) RenameTemplate(userID, templateID, name string) (*models.SheetTemplate, error) {
	return s.UpdateTemplate(userID, templateID, TemplateUpdate{Name: &name})
}

func (s *sheetService) UpdateTemplate(userID, templateID string, update TemplateUpdate) (*models.SheetTemplate, error) {
	current, err := s.GetTemplate(userID, templateID)
	if err != nil {
		return nil, err
	}

	updates := map[string]any{}
	if update.Name != nil {
		updates["name"] = normalizeTitle(*update.Name)
	}
	if update.Icon != nil {
		updates["icon"] = *update.Icon
	}

	grid := gridUpdate{Columns: update.Columns, Rows: update.Rows, Merges: update.Merges, Tabs: update.Tabs}
	if grid.changed() {
		if err := grid.apply(current.Name, current.Columns, current.Rows, current.Merges, current.Tabs, updates); err != nil {
			return nil, err
		}
	}

	if len(updates) == 0 {
		return current, nil
	}
	updates["updated_at"] = utils.GetCurrentTimestamp()
	return s.repo.UpdateTemplate(userID, templateID, updates)
}

func (s *sheetService) DeleteTemplate(userID, templateID string) error {
	if _, err := s.GetTemplate(userID, templateID); err != nil {
		return err
	}
	return s.repo.DeleteTemplate(userID, templateID)
}

func (s *sheetService) MaterializeTemplateTab(userID, templateID, tabID string) (models.SheetTab, error) {
	template, err := s.GetTemplate(userID, templateID)
	if err != nil {
		return models.SheetTab{}, err
	}
	return models.TabFromTemplate(template, tabID)
}

func (s *sheetService) Delete(userID string, sheetID string) error {
	if userID == "" {
		return errors.New("user not authenticated")
	}
	if sheetID == "" {
		return errors.New("invalid sheet id")
	}

	if _, err := s.repo.GetSheetByID(userID, sheetID); err != nil {
		return err
	}

	if err := s.repo.DeleteSheet(userID, sheetID); err != nil {
		return err
	}
	if s.indexer != nil {
		s.indexer.Delete(userID, embed.KindSheet, sheetID)
	}
	return nil
}

const maxTabs = 20

// gridUpdate is the grid half of a sheet or template update.
type gridUpdate struct {
	Columns *models.SheetColumns
	Rows    *models.SheetRows
	Merges  *models.SheetMerges
	Tabs    *models.SheetTabs
}

func (u gridUpdate) changed() bool {
	return u.Columns != nil || u.Rows != nil || u.Merges != nil || u.Tabs != nil
}

// apply lays u over the current grid, validates the result, and records the
// changed JSON columns in updates. When tabs exist, the top-level grid
// mirrors the first tab.
func (u gridUpdate) apply(
	title string,
	columns models.SheetColumns,
	rows models.SheetRows,
	merges models.SheetMerges,
	tabs models.SheetTabs,
	updates map[string]any,
) error {
	if u.Columns != nil {
		columns = *u.Columns
	}
	if u.Rows != nil {
		rows = *u.Rows
	}
	if u.Merges != nil {
		merges = *u.Merges
	}
	if u.Tabs != nil {
		tabs = *u.Tabs
	}

	primaryChanged := u.Columns != nil || u.Rows != nil || u.Merges != nil
	if len(tabs) > 0 && primaryChanged {
		tabs[0].Columns = columns
		tabs[0].Rows = rows
		tabs[0].Merges = merges
	}

	if err := prepareGrid(title, &columns, &rows, &merges, &tabs); err != nil {
		return err
	}

	if u.Columns != nil || u.Tabs != nil {
		updates["columns"] = columns
	}
	if u.Rows != nil || u.Tabs != nil {
		updates["rows"] = rows
	}
	if u.Merges != nil || u.Tabs != nil {
		updates["merges"] = merges
	}
	if u.Tabs != nil || (len(tabs) > 0 && primaryChanged) {
		updates["tabs"] = tabs
	}
	return nil
}

func prepareGrid(
	title string,
	columns *models.SheetColumns,
	rows *models.SheetRows,
	merges *models.SheetMerges,
	tabs *models.SheetTabs,
) error {
	if len(*tabs) > maxTabs {
		return errors.New("too many tabs")
	}

	if len(*tabs) == 0 {
		return normalizePrimary(columns, rows, merges)
	}

	fallback := normalizeTitle(title)
	seen := make(map[string]bool, len(*tabs))
	names := make(map[string]bool, len(*tabs))
	for i := range *tabs {
		tab, err := models.NormalizeSheetTab((*tabs)[i], fallback)
		if err != nil {
			return err
		}
		if seen[tab.ID] {
			tab.ID = utils.PrefixedUUID("tab")
		}
		seen[tab.ID] = true
		// Formulas address tabs by name, so names must be unique.
		base := tab.Name
		for n := 2; names[strings.ToLower(tab.Name)]; n++ {
			tab.Name = fmt.Sprintf("%s (%d)", base, n)
		}
		names[strings.ToLower(tab.Name)] = true
		if err := validateGrid(tab.Columns, tab.Rows); err != nil {
			return err
		}
		(*tabs)[i] = tab
	}

	*columns = (*tabs)[0].Columns
	*rows = (*tabs)[0].Rows
	*merges = (*tabs)[0].Merges
	return nil
}

func normalizePrimary(columns *models.SheetColumns, rows *models.SheetRows, merges *models.SheetMerges) error {
	if err := validateGrid(*columns, *rows); err != nil {
		return err
	}
	if err := models.NormalizeSheetColumns(*columns); err != nil {
		return err
	}
	models.NormalizeSheetCells(*columns, *rows)
	*merges = models.NormalizeMerges(*merges, len(*columns), len(*rows))
	return nil
}

func validateGrid(columns models.SheetColumns, rows models.SheetRows) error {
	if len(columns) == 0 {
		return errors.New("a sheet needs at least one column")
	}
	if len(columns) > maxColumns {
		return errors.New("too many columns")
	}
	if len(rows) > maxRows {
		return errors.New("too many rows")
	}

	seen := make(map[string]bool, len(columns))
	for _, column := range columns {
		if column.ID == "" {
			return errors.New("every column needs an id")
		}
		if seen[column.ID] {
			return errors.New("duplicate column id: " + column.ID)
		}
		seen[column.ID] = true
	}

	for _, row := range rows {
		if row.ID == "" {
			return errors.New("every row needs an id")
		}
		for _, value := range row.Cells {
			if len(value) > maxCellLength {
				return errors.New("cell value is too long")
			}
		}
	}

	return nil
}

func normalizeTitle(title string) string {
	trimmed := strings.TrimSpace(title)
	if trimmed == "" {
		return "Untitled"
	}
	if len(trimmed) > maxTitleLength {
		return trimmed[:maxTitleLength]
	}
	return trimmed
}

func (s *sheetService) indexSheet(sheet *models.Sheet) {
	if s.indexer != nil {
		s.indexer.IndexSheet(sheet)
	}
}

// editTab loads the sheet, applies change to one tab (an empty id is the first
// tab) and saves the workbook. The caller holds the sheet's grid lock.
func (s *sheetService) editTab(userID, sheetID, tabID string, change func(tab *models.SheetTab) error) (*models.Sheet, error) {
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	tabs := workbookTabs(current)
	idx, err := findTab(tabs, tabID)
	if err != nil {
		return nil, err
	}
	tab := tabs[idx]
	tab.Columns = append(models.SheetColumns{}, tab.Columns...)
	tab.Rows = cloneRows(tab.Rows)
	if err := change(&tab); err != nil {
		return nil, err
	}
	tabs[idx] = tab
	return s.update(userID, sheetID, SheetUpdate{Tabs: &tabs})
}

func cloneRows(rows models.SheetRows) models.SheetRows {
	out := make(models.SheetRows, len(rows))
	for i, row := range rows {
		cells := make(map[string]string, len(row.Cells))
		for key, value := range row.Cells {
			cells[key] = value
		}
		row.Cells = cells
		out[i] = row
	}
	return out
}

// typedCells checks column ids and coerces each value to its column's type.
func typedCells(columns models.SheetColumns, cells map[string]string) (map[string]string, error) {
	types := make(map[string]string, len(columns))
	for _, column := range columns {
		types[column.ID] = column.Type
	}
	out := make(map[string]string, len(cells))
	for colID, value := range cells {
		colType, ok := types[colID]
		if !ok {
			return nil, errors.New("unknown column id: " + colID)
		}
		out[colID] = models.NormalizeTypedCell(colType, value)
	}
	return out, nil
}

func (s *sheetService) AddRows(userID, sheetID, tabID string, count int) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	if count <= 0 {
		count = 1
	}
	return s.editTab(userID, sheetID, tabID, func(tab *models.SheetTab) error {
		tab.Rows = append(tab.Rows, models.DefaultSheetRows(tab.Columns, count)...)
		return nil
	})
}

// AddRow writes one entry into the next free row of a tab: blank rows and
// rows that only hold their own row's formulas (a template's prepared rows)
// are reused, and an entry goes above a closing totals row. It returns the
// row's index.
func (s *sheetService) AddRow(userID, sheetID, tabID string, cells map[string]string) (*models.Sheet, int, error) {
	defer s.lockGrid(sheetID)()
	index := -1
	sh, err := s.editTab(userID, sheetID, tabID, func(tab *models.SheetTab) error {
		values, err := typedCells(tab.Columns, cells)
		if err != nil {
			return err
		}
		index = AppendRow(tab, models.SheetRow{ID: utils.PrefixedUUID("row"), Cells: values})
		return nil
	})
	return sh, index, err
}

func (s *sheetService) UpdateCells(userID, sheetID, tabID, rowID string, cells map[string]string) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	return s.editTab(userID, sheetID, tabID, func(tab *models.SheetTab) error {
		values, err := typedCells(tab.Columns, cells)
		if err != nil {
			return err
		}
		for i := range tab.Rows {
			if tab.Rows[i].ID != rowID {
				continue
			}
			for colID, value := range values {
				tab.Rows[i].Cells[colID] = value
			}
			return nil
		}
		return errors.New("row not found")
	})
}

func (s *sheetService) DeleteRows(userID, sheetID, tabID string, rowIDs []string) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	return s.editTab(userID, sheetID, tabID, func(tab *models.SheetTab) error {
		drop := map[string]bool{}
		for _, id := range rowIDs {
			drop[id] = true
		}
		var rows models.SheetRows
		for _, row := range tab.Rows {
			if !drop[row.ID] {
				rows = append(rows, row)
			}
		}
		tab.Rows = rows
		return nil
	})
}

func (s *sheetService) AddColumn(userID, sheetID, tabID, name, colType string, options []string) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Column"
	}
	normalizedType, err := models.NormalizeSheetColumnType(colType)
	if err != nil {
		return nil, err
	}
	return s.editTab(userID, sheetID, tabID, func(tab *models.SheetTab) error {
		column := models.SheetColumn{
			ID:    utils.PrefixedUUID("col"),
			Name:  name,
			Width: 160,
			Type:  normalizedType,
		}
		if normalizedType == models.SheetColumnTypeSelect {
			column.Options = models.NormalizeSelectOptions(options)
		}
		tab.Columns = append(tab.Columns, column)
		for i := range tab.Rows {
			tab.Rows[i].Cells[column.ID] = ""
		}
		return nil
	})
}

// ColumnPatch changes one column; nil and empty fields stay as they are.
type ColumnPatch struct {
	Name    string
	Type    string
	Width   *int
	Options *[]string
	// Format replaces the column's display format; an empty format clears it.
	Format *models.SheetColumnFormat
	Hidden *bool
}

func (s *sheetService) UpdateColumn(userID, sheetID, tabID, columnID string, patch ColumnPatch) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	return s.editTab(userID, sheetID, tabID, func(tab *models.SheetTab) error {
		for i := range tab.Columns {
			column := &tab.Columns[i]
			if column.ID != columnID {
				continue
			}
			if patch.Name != "" {
				column.Name = patch.Name
			}
			if patch.Type != "" {
				normalizedType, err := models.NormalizeSheetColumnType(patch.Type)
				if err != nil {
					return err
				}
				column.Type = normalizedType
			}
			if patch.Width != nil && *patch.Width > 0 {
				column.Width = *patch.Width
			}
			if patch.Options != nil {
				column.Options = models.NormalizeSelectOptions(*patch.Options)
			}
			if patch.Format != nil {
				format := *patch.Format
				column.Format = &format
			}
			if patch.Hidden != nil {
				column.Hidden = *patch.Hidden
			}
			return nil
		}
		return errors.New("column not found")
	})
}

func (s *sheetService) DeleteColumn(userID, sheetID, tabID, columnID string) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	return s.editTab(userID, sheetID, tabID, func(tab *models.SheetTab) error {
		if len(tab.Columns) <= 1 {
			return errors.New("a sheet needs at least one column")
		}
		var columns models.SheetColumns
		for _, column := range tab.Columns {
			if column.ID != columnID {
				columns = append(columns, column)
			}
		}
		if len(columns) == len(tab.Columns) {
			return errors.New("column not found")
		}
		tab.Columns = columns
		for i := range tab.Rows {
			delete(tab.Rows[i].Cells, columnID)
		}
		return nil
	})
}

// TabPatch changes a tab's look; nil fields stay as they are. Renames go
// through RenameTab, which also rewrites the formulas that read the tab.
type TabPatch struct {
	Color              *string
	FrozenRows         *int
	FrozenCols         *int
	ConditionalFormats *[]models.SheetConditionalFormat
}

func (s *sheetService) UpdateTab(userID, sheetID, tabID string, patch TabPatch) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	return s.editTab(userID, sheetID, tabID, func(tab *models.SheetTab) error {
		if patch.Color != nil {
			tab.Color = *patch.Color
		}
		if patch.FrozenRows != nil {
			tab.FrozenRows = *patch.FrozenRows
		}
		if patch.FrozenCols != nil {
			tab.FrozenCols = *patch.FrozenCols
		}
		if patch.ConditionalFormats != nil {
			rules := append([]models.SheetConditionalFormat{}, (*patch.ConditionalFormats)...)
			for i := range rules {
				if rules[i].ID == "" {
					rules[i].ID = utils.PrefixedUUID("cf")
				}
			}
			tab.ConditionalFormats = rules
		}
		return nil
	})
}

// workbookTabs returns a copy of the sheet's tabs. A sheet that still stores
// only the primary grid gets it wrapped as the first tab so tab operations
// (rename, delete, add) have something to address.
func workbookTabs(current *models.Sheet) models.SheetTabs {
	if len(current.Tabs) > 0 {
		return append(models.SheetTabs{}, current.Tabs...)
	}
	return models.SheetTabs{{
		ID:      utils.PrefixedUUID("tab"),
		Name:    normalizeTitle(current.Title),
		Columns: current.Columns,
		Rows:    current.Rows,
		Merges:  current.Merges,
	}}
}

// mergeTabs lays the changed tabs over the server's tabs in the given order.
// A sheet stored before tabs existed has one wrapped tab whose id the client
// cannot know, so the client must send every tab the first time.
func mergeTabs(current models.SheetTabs, changed *models.SheetTabs, order []string) (models.SheetTabs, error) {
	if len(order) == 0 {
		return nil, errors.New("a workbook needs at least one tab")
	}
	byID := make(map[string]models.SheetTab, len(current))
	for _, tab := range current {
		byID[tab.ID] = tab
	}
	if changed != nil {
		for _, tab := range *changed {
			byID[tab.ID] = tab
		}
	}
	merged := make(models.SheetTabs, 0, len(order))
	seen := make(map[string]bool, len(order))
	for _, id := range order {
		if seen[id] {
			continue
		}
		seen[id] = true
		tab, ok := byID[id]
		if !ok {
			return nil, errors.New("unknown tab: " + id)
		}
		merged = append(merged, tab)
	}
	return merged, nil
}

// findTab resolves tabID to an index. An empty id means the first (primary) tab.
func findTab(tabs models.SheetTabs, tabID string) (int, error) {
	if strings.TrimSpace(tabID) == "" {
		return 0, nil
	}
	for i, tab := range tabs {
		if tab.ID == tabID {
			return i, nil
		}
	}
	return -1, errors.New("tab not found")
}

func (s *sheetService) AddTab(userID, sheetID, name string) (*models.Sheet, models.SheetTab, error) {
	defer s.lockGrid(sheetID)()
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, models.SheetTab{}, err
	}
	tabs := workbookTabs(current)
	if len(tabs) >= maxTabs {
		return nil, models.SheetTab{}, errors.New("too many tabs")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = fmt.Sprintf("Sheet %d", len(tabs)+1)
	}
	columns := models.DefaultSheetColumns()
	tab := models.SheetTab{
		ID:      utils.PrefixedUUID("tab"),
		Name:    name,
		Columns: columns,
		Rows:    models.DefaultSheetRows(columns, 20),
		Merges:  models.SheetMerges{},
	}
	tabs = append(tabs, tab)
	sh, err := s.update(userID, sheetID, SheetUpdate{Tabs: &tabs})
	if err != nil {
		return nil, models.SheetTab{}, err
	}
	return sh, tab, nil
}

func (s *sheetService) RenameTab(userID, sheetID, tabID, name string) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("tab name is required")
	}
	tabs := workbookTabs(current)
	idx, err := findTab(tabs, tabID)
	if err != nil {
		return nil, err
	}
	if err := renameTab(tabs, idx, name); err != nil {
		return nil, err
	}
	return s.update(userID, sheetID, SheetUpdate{Tabs: &tabs})
}

func (s *sheetService) DeleteTab(userID, sheetID, tabID string) (*models.Sheet, error) {
	defer s.lockGrid(sheetID)()
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(tabID) == "" {
		return nil, errors.New("tabId is required")
	}
	tabs := workbookTabs(current)
	if len(tabs) <= 1 {
		return nil, errors.New("a workbook needs at least one tab")
	}
	idx, err := findTab(tabs, tabID)
	if err != nil {
		return nil, err
	}
	tabs = append(tabs[:idx], tabs[idx+1:]...)
	return s.update(userID, sheetID, SheetUpdate{Tabs: &tabs})
}

// assertProject rejects a project the user does not own, so a sheet cannot be
// linked to (and preload) another account's project.
func (s *sheetService) assertProject(userID, projectID string) error {
	owned, err := s.repo.ProjectBelongsToUser(userID, projectID)
	if err != nil {
		return err
	}
	if !owned {
		return errors.New("project not found")
	}
	return nil
}
