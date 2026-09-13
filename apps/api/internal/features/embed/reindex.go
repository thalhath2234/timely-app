package embed

import (
	"context"
	"timely-api/internal/models"
)

func (i *indexer) ReindexUser(ctx context.Context, userID string) (int, error) {
	if !i.Enabled() {
		return 0, ErrDisabled
	}
	if userID == "" {
		return 0, nil
	}

	n := 0

	var tasks []models.Task
	if err := i.db.WithContext(ctx).Select("id", "user_id", "name", "description").
		Where("user_id = ?", userID).Find(&tasks).Error; err != nil {
		return n, err
	}
	for _, task := range tasks {
		if err := i.upsert(ctx, Document{
			UserID: userID, Kind: KindTask, EntityID: task.ID, Title: task.Name, Body: task.Description,
		}); err != nil {
			return n, err
		}
		n++
	}

	var docs []models.Document
	if err := i.db.WithContext(ctx).Select("id", "user_id", "title", "plain_text").
		Where("user_id = ?", userID).Find(&docs).Error; err != nil {
		return n, err
	}
	for _, doc := range docs {
		if err := i.upsert(ctx, Document{
			UserID: userID, Kind: KindDoc, EntityID: doc.ID, Title: doc.Title, Body: doc.PlainText,
		}); err != nil {
			return n, err
		}
		n++
	}

	var sheets []models.Sheet
	if err := i.db.WithContext(ctx).Where("user_id = ?", userID).Find(&sheets).Error; err != nil {
		return n, err
	}
	for _, sheet := range sheets {
		if err := i.upsert(ctx, Document{
			UserID: userID, Kind: KindSheet, EntityID: sheet.ID, Title: sheet.Title, Body: FlattenSheet(&sheet),
		}); err != nil {
			return n, err
		}
		n++
	}

	var events []models.Event
	if err := i.db.WithContext(ctx).Select("id", "user_id", "title", "description").
		Where("user_id = ?", userID).Find(&events).Error; err != nil {
		return n, err
	}
	for _, event := range events {
		if err := i.upsert(ctx, Document{
			UserID: userID, Kind: KindEvent, EntityID: event.ID, Title: event.Title, Body: event.Description,
		}); err != nil {
			return n, err
		}
		n++
	}

	var projects []models.Project
	if err := i.db.WithContext(ctx).
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("workspaces.user_id = ?", userID).
		Select("projects.id", "projects.title", "projects.description").
		Find(&projects).Error; err != nil {
		return n, err
	}
	for _, project := range projects {
		if err := i.upsert(ctx, Document{
			UserID: userID, Kind: KindProject, EntityID: project.ID, Title: project.Title, Body: project.Description,
		}); err != nil {
			return n, err
		}
		n++
	}

	return n, nil
}
