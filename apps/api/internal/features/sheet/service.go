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
	Title           *string
	Icon            *string
	Description     *string
	DescriptionRich *models.JSONMap
	Columns         *models.SheetColumns
	Rows            *models.SheetRows
	ProjectID       *string
	IsFavorite      *bool
	Archived        *bool
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
	GetAllByUser(userID string) ([]models.Sheet, error)
	List(userID string, filter SheetFilter) ([]models.Sheet, error)
	GetByID(userID string, sheetID string) (*models.Sheet, error)
	Update(userID string, sheetID string, update SheetUpdate) (*models.Sheet, error)
	Delete(userID string, sheetID string) error
	AddRows(userID, sheetID string, count int) (*models.Sheet, error)
	UpdateCells(userID, sheetID, rowID string, cells map[string]string) (*models.Sheet, error)
	DeleteRows(userID, sheetID string, rowIDs []string) (*models.Sheet, error)
	AddColumn(userID, sheetID, name, colType string) (*models.Sheet, error)
	UpdateColumn(userID, sheetID, columnID, name, colType string, width *int) (*models.Sheet, error)
	DeleteColumn(userID, sheetID, columnID string) (*models.Sheet, error)
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

	if len(sheet.Columns) == 0 {
		sheet.Columns = models.DefaultSheetColumns()
		sheet.Rows = models.DefaultSheetRows(sheet.Columns, defaultRows)
	}

	if err := validateGrid(sheet.Columns, sheet.Rows); err != nil {
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
	if update.Description != nil {
		updates["description"] = *update.Description
	}
	if update.DescriptionRich != nil {
		rich := models.NormalizeDocumentContent(*update.DescriptionRich)
		if update.Description != nil && strings.TrimSpace(*update.Description) != "" && models.IsDocumentContentEmpty(rich) {
			rich = models.DocumentFromPlainText(*update.Description)
		}
		updates["description_rich"] = rich
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

	if update.Columns != nil || update.Rows != nil {
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

		if err := validateGrid(columns, rows); err != nil {
			return nil, err
		}
		if update.Rows != nil {
			models.NormalizeSheetCells(columns, rows)
		}

		if update.Columns != nil {
			updates["columns"] = columns
		}
		if update.Rows != nil {
			updates["rows"] = rows
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
