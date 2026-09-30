package embed

import (
	"context"
	"strings"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/pgvector/pgvector-go"
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
		Where("user_id = ? AND entity_kind = ? AND entity_id = ?", doc.UserID, doc.Kind, doc.EntityID).
		Order("chunk_index").
		Find(&existing).Error; err != nil {
		return err
	}
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
			}
			continue
		}
		need = append(need, pending{index: idx, content: content, hash: hash})
	}

	if len(need) > 0 {
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
				Embedding:   pgvector.NewVector(vectors[n]),
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

	return i.db.WithContext(ctx).
		Where("user_id = ? AND entity_kind = ? AND entity_id = ? AND chunk_index >= ?",
			doc.UserID, doc.Kind, doc.EntityID, len(chunks)).
		Delete(&models.Embedding{}).Error
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
	vec := pgvector.NewVector(vectors[0])
	fetch := limit * 3
	if fetch < 20 {
		fetch = 20
	}

	sql := `
		SELECT entity_kind, entity_id, title, content,
		       (1 - (embedding <=> ?)) AS score
		FROM embeddings
		WHERE user_id = ?
		` + kindFilterSQL(kinds) + `
		ORDER BY embedding <=> ?
		LIMIT ?
	`
	args := []any{vec, userID}
	args = append(args, appendKindArgs(kinds, vec, fetch)...)

	type row struct {
		EntityKind string  `gorm:"column:entity_kind"`
		EntityID   string  `gorm:"column:entity_id"`
		Title      string  `gorm:"column:title"`
		Content    string  `gorm:"column:content"`
		Score      float64 `gorm:"column:score"`
	}
	var rows []row
	if err := i.db.WithContext(ctx).Raw(sql, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}

	seen := map[string]bool{}
	hits := make([]Hit, 0, limit)
	for _, item := range rows {
		key := item.EntityKind + ":" + item.EntityID
		if seen[key] {
			continue
		}
		seen[key] = true
		hits = append(hits, Hit{
			Kind:     item.EntityKind,
			EntityID: item.EntityID,
			Title:    item.Title,
			Content:  item.Content,
			Score:    item.Score,
		})
		if len(hits) >= limit {
			break
		}
	}
	return hits, nil
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

func kindFilterSQL(kinds []string) string {
	if len(kinds) == 0 {
		return ""
	}
	placeholders := strings.Repeat("?,", len(kinds))
	placeholders = placeholders[:len(placeholders)-1]
	return "AND entity_kind IN (" + placeholders + ")"
}

func appendKindArgs(kinds []string, vec pgvector.Vector, fetch int) []any {
	args := make([]any, 0, len(kinds)+2)
	for _, kind := range kinds {
		args = append(args, kind)
	}
	args = append(args, vec, fetch)
	return args
}
