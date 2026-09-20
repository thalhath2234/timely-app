package sheet

import (
	"errors"
	"strings"
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
	Title      *string
	Icon       *string
	Columns    *models.SheetColumns
	Rows       *models.SheetRows
	Merges     *models.SheetMerges
	Tabs       *models.SheetTabs
	ProjectID  *string
	IsFavorite *bool
	Archived   *bool
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
	AddRows(userID, sheetID string, count int) (*models.Sheet, error)
	UpdateCells(userID, sheetID, rowID string, cells map[string]string) (*models.Sheet, error)
	DeleteRows(userID, sheetID string, rowIDs []string) (*models.Sheet, error)
	AddColumn(userID, sheetID, name, colType string) (*models.Sheet, error)
	UpdateColumn(userID, sheetID, columnID, name, colType string, width *int) (*models.Sheet, error)
	DeleteColumn(userID, sheetID, columnID string) (*models.Sheet, error)

	ListTemplates(userID string) ([]models.SheetTemplate, error)
	GetTemplate(userID, templateID string) (*models.SheetTemplate, error)
	CreateTemplate(userID, sheetID, name, tabID string) (*models.SheetTemplate, error)
	RenameTemplate(userID, templateID, name string) (*models.SheetTemplate, error)
	DeleteTemplate(userID, templateID string) error
	MaterializeTemplateTab(userID, templateID, tabID string) (models.SheetTab, error)
}

type sheetService struct {
	repo    SheetRepository
	indexer embed.Indexer
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

	if update.Columns != nil || update.Rows != nil || update.Merges != nil || update.Tabs != nil {
		current, err := s.repo.GetSheetByID(userID, sheetID)
		if err != nil {
			return nil, err
		}

		columns := current.Columns
		if update.Columns != nil {
			columns = *update.Columns
		}

		rows := current.Rows
		if update.Rows != nil {
			rows = *update.Rows
		}

		merges := current.Merges
		if update.Merges != nil {
			merges = *update.Merges
		}

		tabs := current.Tabs
		if update.Tabs != nil {
			tabs = *update.Tabs
		}

		if len(tabs) > 0 && (update.Columns != nil || update.Rows != nil || update.Merges != nil) {
			tabs[0].Columns = columns
			tabs[0].Rows = rows
			tabs[0].Merges = merges
		}

		if err := prepareGrid(current.Title, &columns, &rows, &merges, &tabs); err != nil {
			return nil, err
		}

		if update.Columns != nil || update.Tabs != nil {
			updates["columns"] = columns
		}
		if update.Rows != nil || update.Tabs != nil {
			updates["rows"] = rows
		}
		if update.Merges != nil || update.Tabs != nil {
			updates["merges"] = merges
		}
		if update.Tabs != nil || (len(tabs) > 0 && (update.Columns != nil || update.Rows != nil || update.Merges != nil)) {
			updates["tabs"] = tabs
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
	if _, err := s.GetTemplate(userID, templateID); err != nil {
		return nil, err
	}
	return s.repo.UpdateTemplate(userID, templateID, map[string]any{
		"name":       normalizeTitle(name),
		"updated_at": utils.GetCurrentTimestamp(),
	})
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
	for i := range *tabs {
		tab, err := models.NormalizeSheetTab((*tabs)[i], fallback)
		if err != nil {
			return err
		}
		if seen[tab.ID] {
			tab.ID = utils.PrefixedUUID("tab")
		}
		seen[tab.ID] = true
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

func (s *sheetService) AddRows(userID, sheetID string, count int) (*models.Sheet, error) {
	if count <= 0 {
		count = 1
	}
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	rows := append(models.SheetRows{}, current.Rows...)
	rows = append(rows, models.DefaultSheetRows(current.Columns, count)...)
	return s.Update(userID, sheetID, SheetUpdate{Rows: &rows})
}

func (s *sheetService) UpdateCells(userID, sheetID, rowID string, cells map[string]string) (*models.Sheet, error) {
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	cols := map[string]bool{}
	for _, column := range current.Columns {
		cols[column.ID] = true
	}
	rows := append(models.SheetRows{}, current.Rows...)
	found := false
	for i := range rows {
		if rows[i].ID != rowID {
			continue
		}
		found = true
		if rows[i].Cells == nil {
			rows[i].Cells = map[string]string{}
		}
		types := map[string]string{}
		for _, column := range current.Columns {
			types[column.ID] = column.Type
		}
		for colID, value := range cells {
			if !cols[colID] {
				return nil, errors.New("unknown column id: " + colID)
			}
			rows[i].Cells[colID] = models.NormalizeTypedCell(types[colID], value)
		}
	}
	if !found {
		return nil, errors.New("row not found")
	}
	return s.Update(userID, sheetID, SheetUpdate{Rows: &rows})
}

func (s *sheetService) DeleteRows(userID, sheetID string, rowIDs []string) (*models.Sheet, error) {
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	drop := map[string]bool{}
	for _, id := range rowIDs {
		drop[id] = true
	}
	var rows models.SheetRows
	for _, row := range current.Rows {
		if !drop[row.ID] {
			rows = append(rows, row)
		}
	}
	return s.Update(userID, sheetID, SheetUpdate{Rows: &rows})
}

func (s *sheetService) AddColumn(userID, sheetID, name, colType string) (*models.Sheet, error) {
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Column"
	}
	normalizedType, err := models.NormalizeSheetColumnType(colType)
	if err != nil {
		return nil, err
	}
	column := models.SheetColumn{
		ID:    utils.PrefixedUUID("col"),
		Name:  name,
		Width: 160,
		Type:  normalizedType,
	}
	columns := append(models.SheetColumns{}, current.Columns...)
	columns = append(columns, column)
	rows := append(models.SheetRows{}, current.Rows...)
	for i := range rows {
		if rows[i].Cells == nil {
			rows[i].Cells = map[string]string{}
		}
		rows[i].Cells[column.ID] = ""
	}
	return s.Update(userID, sheetID, SheetUpdate{Columns: &columns, Rows: &rows})
}

func (s *sheetService) UpdateColumn(userID, sheetID, columnID, name, colType string, width *int) (*models.Sheet, error) {
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	columns := append(models.SheetColumns{}, current.Columns...)
	found := false
	for i := range columns {
		if columns[i].ID != columnID {
			continue
		}
		found = true
		if name != "" {
			columns[i].Name = name
		}
		if colType != "" {
			normalizedType, err := models.NormalizeSheetColumnType(colType)
			if err != nil {
				return nil, err
			}
			columns[i].Type = normalizedType
		}
		if width != nil && *width > 0 {
			columns[i].Width = *width
		}
	}
	if !found {
		return nil, errors.New("column not found")
	}
	return s.Update(userID, sheetID, SheetUpdate{Columns: &columns})
}

func (s *sheetService) DeleteColumn(userID, sheetID, columnID string) (*models.Sheet, error) {
	current, err := s.repo.GetSheetByID(userID, sheetID)
	if err != nil {
		return nil, err
	}
	if len(current.Columns) <= 1 {
		return nil, errors.New("a sheet needs at least one column")
	}
	var columns models.SheetColumns
	for _, column := range current.Columns {
		if column.ID != columnID {
			columns = append(columns, column)
		}
	}
	if len(columns) == len(current.Columns) {
		return nil, errors.New("column not found")
	}
	rows := append(models.SheetRows{}, current.Rows...)
	for i := range rows {
		delete(rows[i].Cells, columnID)
	}
	return s.Update(userID, sheetID, SheetUpdate{Columns: &columns, Rows: &rows})
}
