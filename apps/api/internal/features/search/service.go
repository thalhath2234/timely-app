package search

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"timely-api/internal/features/embed"
	"timely-api/internal/models"
	"timely-api/internal/richtext"

	"gorm.io/gorm"
)

type Hit struct {
	Kind    string  `json:"kind"`
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	Snippet string  `json:"snippet"`
	Score   float64 `json:"score,omitempty"`
	Content string  `json:"content,omitempty"`
}

type Service interface {
	// Search is keyword-only: ranked substring matching, no embeddings.
	Search(userID, query string, limit int) ([]Hit, error)
	// SemanticSearch is hybrid: keyword and vector hits fused with reciprocal
	// rank fusion. Without an embedding provider it degrades to keyword-only
	// instead of failing, so callers always get something.
	SemanticSearch(ctx context.Context, userID, query string, limit int, kinds []string) ([]Hit, error)
	Reindex(ctx context.Context, userID string) (int, error)
}

type service struct {
	db      *gorm.DB
	indexer embed.Indexer
}

func NewService(db *gorm.DB, indexer embed.Indexer) Service {
	return &service{db: db, indexer: indexer}
}

func (s *service) Search(userID, query string, limit int) ([]Hit, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	query, filters := splitQuery(strings.TrimSpace(query))
	if query == "" && len(filters) == 0 {
		return []Hit{}, nil
	}
	limit = clampLimit(limit)
	ranked := s.keyword(userID, query, limit, nil, filters)
	hits := make([]Hit, 0, len(ranked))
	for _, kw := range ranked {
		hits = append(hits, kw.Hit)
	}
	return hits, nil
}

func (s *service) SemanticSearch(ctx context.Context, userID, query string, limit int, kinds []string) ([]Hit, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	query, filters := splitQuery(strings.TrimSpace(query))
	if query == "" && len(filters) == 0 {
		return []Hit{}, nil
	}
	limit = clampLimit(limit)
	kinds = allowedKinds(kinds)
	if len(filters) > 0 {
		// Only docs have properties.
		if len(kinds) > 0 && !contains(kinds, "doc") {
			return []Hit{}, nil
		}
		kinds = []string{"doc"}
	}

	// Fetch past the limit so an item ranked low in one list can still be
	// lifted by the other.
	fetch := limit * 2
	keyword := s.keyword(userID, query, fetch, kinds, filters)
	if query == "" {
		return fuse(keyword, nil, limit), nil
	}

	semantic, err := s.vector(ctx, userID, query, fetch, kinds)
	if err != nil {
		if !errors.Is(err, embed.ErrDisabled) {
			log.Printf("search: vector query failed, keyword-only results: %v", err)
		}
		semantic = nil
	}
	if len(filters) > 0 && len(semantic) > 0 {
		semantic = s.keepMatching(userID, semantic, filters)
	}
	return fuse(keyword, semantic, limit), nil
}

// keepMatching drops vector hits whose doc lacks the filtered properties.
func (s *service) keepMatching(userID string, hits []Hit, filters []propertyFilter) []Hit {
	ids := make([]string, 0, len(hits))
	for _, hit := range hits {
		ids = append(ids, hit.ID)
	}
	var keep []string
	if err := withProperties(filters)(s.db.Model(&models.Document{}).
		Where("user_id = ? AND id IN ?", userID, ids)).
		Pluck("id", &keep).Error; err != nil {
		log.Printf("search: property filter failed: %v", err)
		return nil
	}
	ok := map[string]bool{}
	for _, id := range keep {
		ok[id] = true
	}
	out := hits[:0]
	for _, hit := range hits {
		if ok[hit.ID] {
			out = append(out, hit)
		}
	}
	return out
}

func contains(list []string, item string) bool {
	for _, v := range list {
		if v == item {
			return true
		}
	}
	return false
}

func (s *service) vector(ctx context.Context, userID, query string, limit int, kinds []string) ([]Hit, error) {
	if s.indexer == nil || !s.indexer.EnabledFor(userID) {
		return nil, embed.ErrDisabled
	}
	n, err := s.indexer.Count(ctx, userID)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		if _, err := s.indexer.ReindexUser(ctx, userID); err != nil {
			return nil, err
		}
	}
	raw, err := s.indexer.Query(ctx, userID, query, limit, kinds)
	if err != nil {
		return nil, err
	}
	hits := make([]Hit, 0, len(raw))
	for _, item := range raw {
		if item.EntityID == "" {
			continue
		}
		hits = append(hits, Hit{
			Kind:    item.Kind,
			ID:      item.EntityID,
			Title:   item.Title,
			Snippet: snippet(item.Content),
			Score:   item.Score,
			Content: item.Content,
		})
	}
	return hits, nil
}

func (s *service) Reindex(ctx context.Context, userID string) (int, error) {
	if userID == "" {
		return 0, errors.New("user not authenticated")
	}
	if s.indexer == nil || !s.indexer.EnabledFor(userID) {
		return 0, embed.ErrDisabled
	}
	return s.indexer.ReindexUser(ctx, userID)
}

// keyword runs the ranked substring query over every requested kind and
// returns the merged list ordered by tier (exact title, title prefix, title
// substring, body substring), then by most recently updated.
func (s *service) keyword(userID, query string, limit int, kinds []string, filters []propertyFilter) []keywordHit {
	if len(filters) > 0 {
		kinds = []string{"doc"}
	}
	want := map[string]bool{}
	for _, kind := range kinds {
		want[kind] = true
	}
	all := len(kinds) == 0
	// Per-kind cap: enough that one busy kind cannot push the others out,
	// but the merge still has room to interleave tiers.
	perKind := limit
	if perKind < 5 {
		perKind = 5
	}

	var out []keywordHit
	if all || want["task"] {
		out = append(out, s.keywordKind(query, perKind, kindQuery{
			kind: "task", model: &models.Task{},
			title: "name", body: "description",
			scope: func(db *gorm.DB) *gorm.DB { return db.Where("user_id = ?", userID) },
		})...)
	}
	if all || want["project"] {
		out = append(out, s.keywordKind(query, perKind, kindQuery{
			kind: "project", model: &models.Project{},
			title: "projects.title", body: "projects.description", id: "projects.id", updated: "projects.updated_at",
			scope: func(db *gorm.DB) *gorm.DB {
				return db.Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
					Where("workspaces.user_id = ?", userID)
			},
		})...)
	}
	if all || want["doc"] {
		out = append(out, s.keywordKind(query, perKind, kindQuery{
			kind: "doc", model: &models.Document{},
			title: "title", body: "plain_text", lead: frontmatterText,
			scope: func(db *gorm.DB) *gorm.DB { return withProperties(filters)(db.Where("user_id = ?", userID)) },
		})...)
	}
	if all || want["sheet"] {
		out = append(out, s.keywordKind(query, perKind, kindQuery{
			kind: "sheet", model: &models.Sheet{},
			title: "title",
			scope: func(db *gorm.DB) *gorm.DB { return db.Where("user_id = ?", userID) },
		})...)
	}
	if all || want["event"] {
		out = append(out, s.keywordKind(query, perKind, kindQuery{
			kind: "event", model: &models.Event{},
			title: "title", body: "description",
			scope: func(db *gorm.DB) *gorm.DB { return db.Where("user_id = ?", userID) },
		})...)
	}

	// Stable: within a tier the per-kind order (most recent first) and the
	// kind order (tasks, projects, docs, sheets, events) are preserved.
	sort.SliceStable(out, func(i, j int) bool { return out[i].Tier > out[j].Tier })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

type kindQuery struct {
	kind    string
	model   any
	title   string
	body    string // empty when the kind has no body column
	lead    string // properties text at the start of body, shown tidied in snippets
	id      string // defaults to "id"
	updated string // defaults to "updated_at"
	scope   func(*gorm.DB) *gorm.DB
}

func (s *service) keywordKind(query string, limit int, q kindQuery) []keywordHit {
	if q.id == "" {
		q.id = "id"
	}
	if q.updated == "" {
		q.updated = "updated_at"
	}
	escaped := escapeLike(query)
	like := "%" + escaped + "%"
	prefix := escaped + "%"

	tier := fmt.Sprintf(
		"CASE WHEN lower(%[1]s) = lower(?) THEN %[2]d WHEN %[1]s ILIKE ? THEN %[3]d WHEN %[1]s ILIKE ? THEN %[4]d ELSE %[5]d END",
		q.title, tierExactTitle, tierTitlePrefix, tierTitleMatch, tierBodyMatch,
	)
	leadSelect := "'' AS lead"
	if q.lead != "" {
		leadSelect = "COALESCE(" + q.lead + ", '') AS lead"
	}
	bodySelect := "'' AS body"
	match := q.title + " ILIKE ?"
	matchArgs := []any{like}
	if q.body != "" {
		bodySelect = q.body + " AS body"
		match = "(" + q.title + " ILIKE ? OR " + q.body + " ILIKE ?)"
		matchArgs = append(matchArgs, like)
	}
	if query == "" {
		// Filters alone (status:draft): every record in scope, newest first.
		match, matchArgs = "TRUE", nil
	}

	type row struct {
		ID    string
		Title string
		Body  string
		Lead  string
		Tier  int
	}
	var rows []row
	db := s.db.Model(q.model).
		Select(q.id+" AS id, "+q.title+" AS title, "+bodySelect+", "+leadSelect+", "+tier+" AS tier", query, prefix, like).
		Where(match, matchArgs...).
		Order("tier DESC").
		Order(q.updated + " DESC").
		Limit(limit)
	if q.scope != nil {
		db = q.scope(db)
	}
	if err := db.Scan(&rows).Error; err != nil {
		log.Printf("search: keyword %s query failed: %v", q.kind, err)
		return nil
	}

	out := make([]keywordHit, 0, len(rows))
	for _, r := range rows {
		text := r.Body
		if q.body == "" {
			text = r.Title
		}
		if r.Lead != "" {
			// "tags: travel, 2026; status: draft · Book flights..." instead of raw YAML.
			rest := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(text), strings.TrimSpace(r.Lead)))
			if line := richtext.DescribeProperties(richtext.ParseProperties(r.Lead)); line != "" {
				rest = strings.TrimSpace(line + " · " + rest)
			}
			text = rest
		}
		out = append(out, keywordHit{
			Hit:  Hit{Kind: q.kind, ID: r.ID, Title: r.Title, Snippet: snippet(text)},
			Tier: r.Tier,
		})
	}
	return out
}

func clampLimit(limit int) int {
	if limit <= 0 || limit > 50 {
		return 20
	}
	return limit
}

var searchKinds = map[string]bool{"task": true, "project": true, "doc": true, "sheet": true, "event": true}

func allowedKinds(kinds []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, kind := range kinds {
		kind = strings.ToLower(strings.TrimSpace(kind))
		if !searchKinds[kind] || seen[kind] {
			continue
		}
		seen[kind] = true
		out = append(out, kind)
	}
	return out
}

func snippet(text string) string {
	text = strings.TrimSpace(strings.ReplaceAll(text, "\n", " "))
	if len(text) > 160 {
		return text[:157] + "..."
	}
	return text
}
