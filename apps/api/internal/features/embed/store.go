package embed

import (
	"context"
	"strings"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm/clause"
)

func (i *indexer) upsert(ctx context.Context, doc Document) error {
	if doc.UserID == "" || doc.Kind == "" || doc.EntityID == "" {
		return nil
	}
	_, model := i.credentials(doc.UserID)
	if !i.EnabledFor(doc.UserID) {
		return ErrDisabled
	}

	combined := validUTF8(Combine(doc.Title, doc.Body))
	chunks := Chunk(combined)
	if len(chunks) == 0 {
		i.Delete(doc.UserID, doc.Kind, doc.EntityID)
		return nil
	}

	var existing []models.Embedding
	if err := i.db.WithContext(ctx).
		Select("id", "chunk_index", "title", "content_hash", "model", "created_at").
		Where("user_id = ? AND entity_kind = ? AND entity_id = ?", doc.UserID, doc.Kind, doc.EntityID).
		Order("chunk_index").
		Find(&existing).Error; err != nil {
		return err
	}
	changed := false
	byIndex := map[int]models.Embedding{}
	for _, row := range existing {
		byIndex[row.ChunkIndex] = row
	}

	type pending struct {
		index   int
		content string
		hash    string
	}
	var need []pending
	for idx, content := range chunks {
		hash := contentHash(model, content)
		if prev, ok := byIndex[idx]; ok && prev.ContentHash == hash && prev.Model == model {
			if prev.Title != doc.Title {
				_ = i.db.WithContext(ctx).Model(&models.Embedding{}).Where("id = ?", prev.ID).Update("title", doc.Title).Error
				changed = true
			}
			continue
		}
		need = append(need, pending{index: idx, content: content, hash: hash})
	}

	if len(need) > 0 {
		changed = true
		texts := make([]string, len(need))
		for n, item := range need {
			texts[n] = item.content
		}
		vectors, err := i.embedTexts(ctx, doc.UserID, texts)
		if err != nil {
			return err
		}
		if err := CheckDims(vectors); err != nil {
			return err
		}
		now := utils.GetCurrentTimestamp()
		for n, item := range need {
			row := models.Embedding{
				ID:          utils.NewEmbeddingID(),
				UserID:      doc.UserID,
				EntityKind:  doc.Kind,
				EntityID:    doc.EntityID,
				ChunkIndex:  item.index,
				Title:       doc.Title,
				Content:     item.content,
				Embedding:   models.Vector(vectors[n]),
				ContentHash: item.hash,
				Model:       model,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
			if prev, ok := byIndex[item.index]; ok {
				row.ID = prev.ID
				row.CreatedAt = prev.CreatedAt
			}
			if err := i.db.WithContext(ctx).Clauses(clause.OnConflict{
				Columns: []clause.Column{
					{Name: "user_id"},
					{Name: "entity_kind"},
					{Name: "entity_id"},
					{Name: "chunk_index"},
				},
				DoUpdates: clause.AssignmentColumns([]string{
					"title", "content", "embedding", "content_hash", "model", "updated_at",
				}),
			}).Create(&row).Error; err != nil {
				return err
			}
		}
	}

	result := i.db.WithContext(ctx).
		Where("user_id = ? AND entity_kind = ? AND entity_id = ? AND chunk_index >= ?",
			doc.UserID, doc.Kind, doc.EntityID, len(chunks)).
		Delete(&models.Embedding{})
	if changed || result.RowsAffected > 0 {
		i.vectors.invalidate(doc.UserID)
	}
	return result.Error
}

// Invalidate drops the account's cached vectors so the next Query reloads
// them; call it after writing the embeddings table outside this package.
func (i *indexer) Invalidate(userID string) {
	if i == nil || userID == "" {
		return
	}
	i.vectors.invalidate(userID)
}

// loadChunks reads every chunk the account owns into the cache.
func (i *indexer) loadChunks(ctx context.Context, userID string) ([]cachedChunk, error) {
	var rows []models.Embedding
	if err := i.db.WithContext(ctx).
		Select("entity_kind", "entity_id", "title", "content", "embedding").
		Where("user_id = ?", userID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	chunks := make([]cachedChunk, 0, len(rows))
	for _, row := range rows {
		chunks = append(chunks, cachedChunk{
			kind:     row.EntityKind,
			entityID: row.EntityID,
			title:    row.Title,
			content:  row.Content,
			vec:      []float32(row.Embedding),
		})
	}
	return chunks, nil
}

func (i *indexer) Count(ctx context.Context, userID string) (int64, error) {
	var n int64
	err := i.db.WithContext(ctx).Model(&models.Embedding{}).Where("user_id = ?", userID).Count(&n).Error
	return n, err
}

func (i *indexer) Query(ctx context.Context, userID, query string, limit int, kinds []string) ([]Hit, error) {
	if !i.EnabledFor(userID) {
		return nil, ErrDisabled
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, ErrEmptyQuery
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	kinds = normalizeKinds(kinds)

	vectors, err := i.embedTexts(ctx, userID, []string{query})
	if err != nil {
		return nil, err
	}
	if err := CheckDims(vectors); err != nil {
		return nil, err
	}
	chunks, err := i.vectors.get(ctx, userID)
	if err != nil {
		return nil, err
	}
	return rank(chunks, vectors[0], kinds, limit), nil
}

// Related returns the items nearest to an indexed one. It needs no
// embedding call: the source's own vectors are the query. ErrNotIndexed
// means the source has no vectors yet.
func (i *indexer) Related(ctx context.Context, userID, kind, entityID string, limit int, kinds []string) (Source, []Hit, error) {
	if !i.EnabledFor(userID) {
		return Source{}, nil, ErrDisabled
	}
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	chunks, err := i.vectors.get(ctx, userID)
	if err != nil {
		return Source{}, nil, err
	}
	src, hits, ok := related(chunks, kind, entityID, normalizeKinds(kinds), limit)
	if !ok {
		return Source{}, nil, ErrNotIndexed
	}
	return src, hits, nil
}

func normalizeKinds(kinds []string) []string {
	allowed := map[string]bool{
		KindTask: true, KindProject: true, KindDoc: true, KindSheet: true, KindEvent: true,
	}
	var out []string
	seen := map[string]bool{}
	for _, kind := range kinds {
		kind = strings.ToLower(strings.TrimSpace(kind))
		if !allowed[kind] || seen[kind] {
			continue
		}
		seen[kind] = true
		out = append(out, kind)
	}
	return out
}
