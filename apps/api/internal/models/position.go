package models

import "gorm.io/gorm"

// WorkspaceItemOrder lists a workspace's statuses, labels and custom fields in
// the order they were made. Without an ORDER BY Postgres returns heap order,
// and any UPDATE moves the row to the end. created_at holds only a day and ids
// are random, so they only break ties (rows restored from an older backup all
// have position 0).
const WorkspaceItemOrder = "position, created_at, id"

// OrderWorkspaceItems is a Preload condition that applies WorkspaceItemOrder.
func OrderWorkspaceItems(db *gorm.DB) *gorm.DB {
	return db.Order(WorkspaceItemOrder)
}

// nextPosition returns one past the highest position used in the workspace,
// so a new item lands at the end of its list. Several rows inserted in one
// statement read the same value, so callers that batch-create set Position
// themselves.
func nextPosition(tx *gorm.DB, table, workspaceID string) (int64, error) {
	var max int64
	err := tx.Session(&gorm.Session{NewDB: true}).Table(table).
		Where("workspace_id = ?", workspaceID).
		Select("COALESCE(MAX(position), 0)").Scan(&max).Error
	return max + 1, err
}
