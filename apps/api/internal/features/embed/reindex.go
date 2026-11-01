package embed

import (
	"context"
	"errors"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

func (i *indexer) ReindexUser(ctx context.Context, userID string) (int, error) {
	return i.Reindex(ctx, userID, nil)
}

// Reindex re-embeds every record the account owns. Rows whose content and
// model are unchanged are skipped by upsert, so switching the embedding model
// or key re-embeds only what the new model has not seen. Rows left behind by
// deleted items are removed first. progress, when set, is called after each
// record.
func (i *indexer) Reindex(ctx context.Context, userID string, progress func(done, total int)) (int, error) {
	if !i.EnabledFor(userID) {
		return 0, ErrDisabled
	}
	if userID == "" {
		return 0, nil
	}
	i.vectors.invalidate(userID)
	defer i.vectors.invalidate(userID)
	if err := i.deleteOrphans(ctx, userID); err != nil {
		return 0, err
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

// orphanQueries delete an account's rows whose item no longer exists for it.
// They check the live tables at delete time, so an item created while a
// reindex runs keeps its rows.
var orphanQueries = []string{
	`DELETE FROM embeddings e WHERE e.user_id = ? AND e.entity_kind = 'task' AND NOT EXISTS (SELECT 1 FROM tasks x WHERE x.id = e.entity_id AND x.user_id = e.user_id)`,
	`DELETE FROM embeddings e WHERE e.user_id = ? AND e.entity_kind = 'doc' AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.id = e.entity_id AND x.user_id = e.user_id)`,
	`DELETE FROM embeddings e WHERE e.user_id = ? AND e.entity_kind = 'sheet' AND NOT EXISTS (SELECT 1 FROM sheets x WHERE x.id = e.entity_id AND x.user_id = e.user_id)`,
	`DELETE FROM embeddings e WHERE e.user_id = ? AND e.entity_kind = 'event' AND NOT EXISTS (SELECT 1 FROM events x WHERE x.id = e.entity_id AND x.user_id = e.user_id)`,
	`DELETE FROM embeddings e WHERE e.user_id = ? AND e.entity_kind = 'project' AND NOT EXISTS (SELECT 1 FROM projects x JOIN workspaces w ON w.id = x.workspace_id WHERE x.id = e.entity_id AND w.user_id = e.user_id)`,
}

func (i *indexer) deleteOrphans(ctx context.Context, userID string) error {
	for _, query := range orphanQueries {
		if err := i.db.WithContext(ctx).Exec(query, userID).Error; err != nil {
			return err
		}
	}
	return nil
}

// load reads one item's current title and text the way collect does; ok is
// false when the account has no such item.
func (i *indexer) load(ctx context.Context, userID, kind, entityID string) (doc Document, ok bool, err error) {
	db := i.db.WithContext(ctx)
	doc = Document{UserID: userID, Kind: kind, EntityID: entityID}
	switch kind {
	case KindTask:
		var row models.Task
		err = db.Select("id", "user_id", "name", "description").Where("id = ? AND user_id = ?", entityID, userID).Take(&row).Error
		doc.Title, doc.Body = row.Name, row.Description
	case KindDoc:
		var row models.Document
		err = db.Select("id", "user_id", "title", "plain_text", "content").Where("id = ? AND user_id = ?", entityID, userID).Take(&row).Error
		doc.Title, doc.Body = row.Title, DocBody(&row)
	case KindSheet:
		var row models.Sheet
		err = db.Where("id = ? AND user_id = ?", entityID, userID).Take(&row).Error
		doc.Title, doc.Body = row.Title, FlattenSheet(&row)
	case KindEvent:
		var row models.Event
		err = db.Select("id", "user_id", "title", "description").Where("id = ? AND user_id = ?", entityID, userID).Take(&row).Error
		doc.Title, doc.Body = row.Title, row.Description
	case KindProject:
		var row models.Project
		err = db.Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
			Where("projects.id = ? AND workspaces.user_id = ?", entityID, userID).
			Select("projects.id", "projects.title", "projects.description").
			Take(&row).Error
		doc.Title, doc.Body = row.Title, row.Description
	default:
		return doc, false, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return doc, false, nil
	}
	return doc, err == nil, err
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
	if err := i.db.WithContext(ctx).Select("id", "user_id", "title", "plain_text", "content").
		Where("user_id = ?", userID).Find(&docs).Error; err != nil {
		return nil, err
	}
	for _, doc := range docs {
		out = append(out, Document{UserID: userID, Kind: KindDoc, EntityID: doc.ID, Title: doc.Title, Body: DocBody(&doc)})
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
