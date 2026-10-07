package sheet

import "timely-api/internal/models"

// TabMatcher picks the rows of one tab that satisfy a caller's criteria. The
// caller owns what the columns mean; the sheet module owns which sheets and
// tabs are searched.
type TabMatcher func(sheet models.Sheet, tab models.SheetTab) []models.SheetRow

// RowMatch locates one row a TabMatcher selected.
type RowMatch struct {
	Sheet models.Sheet
	Tab   models.SheetTab
	Row   models.SheetRow
}

// RowFinder searches a person's sheet content. It is the read-only seam other
// modules use instead of querying sheet tables themselves.
type RowFinder interface {
	// FindRows runs match over every tab of the account's non-archived sheets
	// (a primary-grid-only sheet counts as one tab) and returns the rows it
	// selected. Other accounts' sheets are never visible. Results follow the
	// sheets' updated_at DESC order, then tab order, then row order.
	FindRows(userID string, match TabMatcher) ([]RowMatch, error)
}

type rowFinder struct {
	repo SheetRepository
}

func NewRowFinder(repo SheetRepository) RowFinder {
	return &rowFinder{repo: repo}
}

func (f *rowFinder) FindRows(userID string, match TabMatcher) ([]RowMatch, error) {
	archived := false
	sheets, err := f.repo.ListSheets(userID, SheetFilter{Archived: &archived})
	if err != nil {
		return nil, err
	}
	matches := []RowMatch{}
	for _, sheet := range sheets {
		for _, tab := range TabsOf(sheet) {
			for _, row := range match(sheet, tab) {
				matches = append(matches, RowMatch{Sheet: sheet, Tab: tab, Row: row})
			}
		}
	}
	return matches, nil
}
