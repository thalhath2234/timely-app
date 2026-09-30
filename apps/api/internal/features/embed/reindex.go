package embed

import (
	"context"
	"timely-api/internal/models"
)

func (i *indexer) ReindexUser(ctx context.Context, userID string) (int, error) {
	return i.Reindex(ctx, userID, nil)
}

// Reindex re-embeds every record the account owns. Rows whose content and
// model are unchanged are skipped by upsert, so switching the embedding model
// or key re-embeds only what the new model has not seen. progress, when set,
// is called after each record.
func (i *indexer) Reindex(ctx context.Context, userID string, progress func(done, total int)) (int, error) {
	if !i.EnabledFor(userID) {
		return 0, ErrDisabled
	}
	if userID == "" {
		return 0, nil
	}
	docs, err := i.collect(ctx, userID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, doc := range docs {
		if err := i.upsert(ctx, doc); err != nil {
			return n, err
		}
		n++
		if progress != nil {
			progress(n, len(docs))
		}
	}
	return n, nil
}

func (i *indexer) collect(ctx context.Context, userID string) ([]Document, error) {
	var out []Document

	var tasks []models.Task
	if err := i.db.WithContext(ctx).Select("id", "user_id", "name", "description").
		Where("user_id = ?", userID).Find(&tasks).Error; err != nil {
		return nil, err
	}
	for _, task := range tasks {
		out = append(out, Document{UserID: userID, Kind: KindTask, EntityID: task.ID, Title: task.Name, Body: task.Description})
	}

	var docs []models.Document
	if err := i.db.WithContext(ctx).Select("id", "user_id", "title", "plain_text").
		Where("user_id = ?", userID).Find(&docs).Error; err != nil {
		return nil, err
	}
	for _, doc := range docs {
		out = append(out, Document{UserID: userID, Kind: KindDoc, EntityID: doc.ID, Title: doc.Title, Body: doc.PlainText})
	}

	var sheets []models.Sheet
	if err := i.db.WithContext(ctx).Where("user_id = ?", userID).Find(&sheets).Error; err != nil {
		return nil, err
	}
	for idx := range sheets {
		out = append(out, Document{UserID: userID, Kind: KindSheet, EntityID: sheets[idx].ID, Title: sheets[idx].Title, Body: FlattenSheet(&sheets[idx])})
	}

	var events []models.Event
	if err := i.db.WithContext(ctx).Select("id", "user_id", "title", "description").
		Where("user_id = ?", userID).Find(&events).Error; err != nil {
		return nil, err
	}
	for _, event := range events {
		out = append(out, Document{UserID: userID, Kind: KindEvent, EntityID: event.ID, Title: event.Title, Body: event.Description})
	}

	var projects []models.Project
	if err := i.db.WithContext(ctx).
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("workspaces.user_id = ?", userID).
		Select("projects.id", "projects.title", "projects.description").
		Find(&projects).Error; err != nil {
		return nil, err
	}
	for _, project := range projects {
		out = append(out, Document{UserID: userID, Kind: KindProject, EntityID: project.ID, Title: project.Title, Body: project.Description})
	}

	return out, nil
}
