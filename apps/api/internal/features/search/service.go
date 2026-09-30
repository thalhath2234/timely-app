package search

import (
	"context"
	"errors"
	"strings"
	"timely-api/internal/features/embed"
	"timely-api/internal/models"

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
	Search(userID, query string, limit int) ([]Hit, error)
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
	query = strings.TrimSpace(query)
	if query == "" {
		return []Hit{}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	like := "%" + query + "%"
	perKind := (limit / 5) + 3

	var hits []Hit
	hits = append(hits, s.tasks(userID, like, perKind)...)
	hits = append(hits, s.projects(userID, like, perKind)...)
	hits = append(hits, s.docs(userID, like, perKind)...)
	hits = append(hits, s.sheets(userID, like, perKind)...)
	hits = append(hits, s.events(userID, like, perKind)...)
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits, nil
}

func (s *service) SemanticSearch(ctx context.Context, userID, query string, limit int, kinds []string) ([]Hit, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if s.indexer == nil || !s.indexer.EnabledFor(userID) {
		return nil, embed.ErrDisabled
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return []Hit{}, nil
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
	seen := map[string]bool{}
	hits := make([]Hit, 0, len(raw))
	for _, item := range raw {
		key := item.Kind + ":" + item.EntityID
		if item.EntityID == "" || seen[key] || seen[item.EntityID] {
			continue
		}
		seen[key] = true
		seen[item.EntityID] = true
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

func (s *service) tasks(userID, like string, limit int) []Hit {
	var rows []models.Task
	_ = s.db.Select("id", "name", "description").
		Where("user_id = ?", userID).
		Where("name ILIKE ? OR description ILIKE ?", like, like).
		Limit(limit).
		Find(&rows)
	out := make([]Hit, 0, len(rows))
	for _, row := range rows {
		out = append(out, Hit{Kind: "task", ID: row.ID, Title: row.Name, Snippet: snippet(row.Description)})
	}
	return out
}

func (s *service) projects(userID, like string, limit int) []Hit {
	var rows []models.Project
	_ = s.db.
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("workspaces.user_id = ?", userID).
		Where("projects.title ILIKE ? OR projects.description ILIKE ?", like, like).
		Select("projects.id", "projects.title", "projects.description").
		Limit(limit).
		Find(&rows)
	out := make([]Hit, 0, len(rows))
	for _, row := range rows {
		out = append(out, Hit{Kind: "project", ID: row.ID, Title: row.Title, Snippet: snippet(row.Description)})
	}
	return out
}

func (s *service) docs(userID, like string, limit int) []Hit {
	var rows []models.Document
	_ = s.db.Select("id", "title", "plain_text").
		Where("user_id = ?", userID).
		Where("title ILIKE ? OR plain_text ILIKE ?", like, like).
		Limit(limit).
		Find(&rows)
	out := make([]Hit, 0, len(rows))
	for _, row := range rows {
		out = append(out, Hit{Kind: "doc", ID: row.ID, Title: row.Title, Snippet: snippet(row.PlainText)})
	}
	return out
}

func (s *service) sheets(userID, like string, limit int) []Hit {
	var rows []models.Sheet
	_ = s.db.Select("id", "title").
		Where("user_id = ?", userID).
		Where("title ILIKE ?", like).
		Limit(limit).
		Find(&rows)
	out := make([]Hit, 0, len(rows))
	for _, row := range rows {
		out = append(out, Hit{Kind: "sheet", ID: row.ID, Title: row.Title, Snippet: snippet(row.Title)})
	}
	return out
}

func (s *service) events(userID, like string, limit int) []Hit {
	var rows []models.Event
	_ = s.db.Select("id", "title", "description").
		Where("user_id = ?", userID).
		Where("title ILIKE ? OR description ILIKE ?", like, like).
		Limit(limit).
		Find(&rows)
	out := make([]Hit, 0, len(rows))
	for _, row := range rows {
		out = append(out, Hit{Kind: "event", ID: row.ID, Title: row.Title, Snippet: snippet(row.Description)})
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
