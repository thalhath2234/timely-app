package embed

import (
	"context"
	"database/sql"
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
		i.deleteRows(doc.UserID, doc.Kind, doc.EntityID)
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
		// The provider can take seconds. An item changed meanwhile (an edit,
		// a restore) no longer has this text, and whatever changed it queues
		// the new text (an edit its own index job, a restore a rebuild), which
		// these late vectors must not overwrite.
		if !i.unchanged(ctx, doc, combined) {
			return nil
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

// unchanged reports whether the item still has the title and text in doc
// (combined is what was embedded). A failed read counts as unchanged, so the
// write goes ahead as it did before this check.
func (i *indexer) unchanged(ctx context.Context, doc Document, combined string) bool {
	now, ok, err := i.load(ctx, doc.UserID, doc.Kind, doc.EntityID)
	if err != nil {
		return true
	}
	return ok && now.Title == doc.Title && validUTF8(Combine(now.Title, now.Body)) == combined
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
		Select("entity_kind", "entity_id", "title", "content", "model", "embedding").
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
			model:    row.Model,
			vec:      []float32(row.Embedding),
		})
	}
	return chunks, nil
}

// hasWords is a Postgres pattern that matches a title with anything but
// white space in it: the characters Go's strings.TrimSpace removes, which is
// what indexing trims. btrim removed spaces only, so a title of tabs or
// no-break spaces counted as missing for good, and every search queued a
// rebuild for it.
const hasWords = `[^\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`

// missingQuery counts the account's items that have a title but no index rows
// made by the current model (@model) and no index job waiting or running for
// them. Counting coverage, rather than whether any row exists, catches an
// index left partial by a restore, an interrupted rebuild or a failed job.
// Rows of an earlier model do not count: searches leave them out (see rank),
// so a rebuild that failed after a model change is tried again later.
const missingQuery = `SELECT
	(SELECT count(*) FROM tasks x WHERE x.user_id = @user AND x.name ~ '` + hasWords + `'
		AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.user_id = @user AND e.entity_kind = 'task' AND e.entity_id = x.id AND e.model = @model)
		AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'index:task:' || x.id AND j.status IN ('pending', 'running')))
	+ (SELECT count(*) FROM documents x WHERE x.user_id = @user AND x.title ~ '` + hasWords + `'
		AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.user_id = @user AND e.entity_kind = 'doc' AND e.entity_id = x.id AND e.model = @model)
		AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'index:doc:' || x.id AND j.status IN ('pending', 'running')))
	+ (SELECT count(*) FROM sheets x WHERE x.user_id = @user AND x.title ~ '` + hasWords + `'
		AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.user_id = @user AND e.entity_kind = 'sheet' AND e.entity_id = x.id AND e.model = @model)
		AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'index:sheet:' || x.id AND j.status IN ('pending', 'running')))
	+ (SELECT count(*) FROM events x WHERE x.user_id = @user AND x.title ~ '` + hasWords + `'
		AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.user_id = @user AND e.entity_kind = 'event' AND e.entity_id = x.id AND e.model = @model)
		AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'index:event:' || x.id AND j.status IN ('pending', 'running')))
	+ (SELECT count(*) FROM projects x JOIN workspaces w ON w.id = x.workspace_id WHERE w.user_id = @user AND x.title ~ '` + hasWords + `'
		AND NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.user_id = @user AND e.entity_kind = 'project' AND e.entity_id = x.id AND e.model = @model)
		AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = 'index:project:' || x.id AND j.status IN ('pending', 'running')))`

func (i *indexer) Missing(ctx context.Context, userID string) (int64, error) {
	_, model := i.credentials(userID)
	var n int64
	err := i.db.WithContext(ctx).Raw(missingQuery, sql.Named("user", userID), sql.Named("model", model)).Scan(&n).Error
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

	_, model := i.credentials(userID)
	vec, err := i.queryVector(ctx, userID, model, query)
	if err != nil {
		return nil, err
	}
	chunks, err := i.vectors.get(ctx, userID)
	if err != nil {
		return nil, err
	}
	return rank(chunks, vec, model, kinds, limit), nil
}

// queryVector embeds a search query, or reuses the vector it got for the same
// words and model a moment ago, or waits for the one being fetched now: the
// palette's plain and smart searches ask for the same query at once, and
// hints ask with an item's words on every view.
func (i *indexer) queryVector(ctx context.Context, userID, model, query string) ([]float32, error) {
	key := userID + "\x00" + model + "\x00" + query
	return queryVectors.share(ctx, key, func() ([]float32, error) {
		vectors, err := i.embedTexts(ctx, userID, []string{query})
		if err != nil {
			return nil, err
		}
		if err := CheckDims(vectors); err != nil {
			return nil, err
		}
		return vectors[0], nil
	})
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
	_, model := i.credentials(userID)
	src, hits, ok := related(chunks, kind, entityID, model, normalizeKinds(kinds), limit)
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
