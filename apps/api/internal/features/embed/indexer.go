package embed

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

const (
	KindTask    = "task"
	KindProject = "project"
	KindDoc     = "doc"
	KindSheet   = "sheet"
	KindEvent   = "event"

	defaultModel = "openai/text-embedding-3-small"
	vectorDims   = 1536
)

var (
	ErrDisabled   = errors.New("semantic search is not configured (add an OpenRouter key in Settings → Agent)")
	ErrEmptyQuery = errors.New("query is empty")
)

// Credentials resolves the OpenRouter key and embedding model for one account.
// An empty key means the account has none of its own.
type Credentials func(userID string) (key, model string)

// IndexQueue defers embedding work to the job worker.
type IndexQueue interface {
	EnqueueIndex(userID, kind, entityID, title, body string) error
}

// Indexer stores OpenRouter embeddings as real[] rows and ranks them in
// memory per account (ADR 0011).
type Indexer interface {
	Enabled() bool
	EnabledFor(userID string) bool
	SetQueue(IndexQueue)
	SetCredentials(Credentials)
	IndexDocument(ctx context.Context, doc Document) error
	IndexTask(*models.Task)
	IndexProject(*models.Project)
	IndexDoc(*models.Document)
	IndexSheet(*models.Sheet)
	IndexEvent(*models.Event)
	Delete(userID, kind, entityID string)
	Invalidate(userID string)
	Query(ctx context.Context, userID, query string, limit int, kinds []string) ([]Hit, error)
	Count(ctx context.Context, userID string) (int64, error)
	ReindexUser(ctx context.Context, userID string) (int, error)
	Reindex(ctx context.Context, userID string, progress func(done, total int)) (int, error)
}

type Document struct {
	UserID   string
	Kind     string
	EntityID string
	Title    string
	Body     string
}

type Hit struct {
	Kind     string  `json:"kind"`
	EntityID string  `json:"id"`
	Title    string  `json:"title"`
	Content  string  `json:"content"`
	Score    float64 `json:"score"`
}

type indexer struct {
	db      *gorm.DB
	http    *http.Client
	model   string
	queue   IndexQueue
	resolve Credentials
	vectors *vectorCache
}

func New(db *gorm.DB) Indexer {
	model := strings.TrimSpace(os.Getenv("OPENROUTER_EMBED_MODEL"))
	if model == "" {
		model = defaultModel
	}
	i := &indexer{
		db:    db,
		http:  defaultHTTPClient(),
		model: model,
	}
	i.vectors = newVectorCache(cacheTTL, i.loadChunks)
	return i
}

// Enabled reports whether any account could be indexed: accounts supply their
// own OpenRouter key; there is no server key. Per-account checks use EnabledFor.
func (i *indexer) Enabled() bool {
	return i != nil && i.resolve != nil
}

func (i *indexer) EnabledFor(userID string) bool {
	key, _ := i.credentials(userID)
	return key != ""
}

func (i *indexer) SetCredentials(resolve Credentials) {
	i.resolve = resolve
}

// credentials returns the account's own key and embedding model.
func (i *indexer) credentials(userID string) (string, string) {
	if i == nil {
		return "", ""
	}
	if i.resolve != nil && userID != "" {
		if key, model := i.resolve(userID); key != "" {
			if model == "" {
				model = defaultModel
			}
			return key, model
		}
	}
	return "", i.model
}

func (i *indexer) SetQueue(queue IndexQueue) {
	i.queue = queue
}

func (i *indexer) IndexDocument(ctx context.Context, doc Document) error {
	if !i.Enabled() {
		return nil
	}
	return i.upsert(ctx, doc)
}

func (i *indexer) IndexTask(task *models.Task) {
	if task == nil || task.UserID == nil || *task.UserID == "" {
		return
	}
	i.upsertAsync(Document{
		UserID:   *task.UserID,
		Kind:     KindTask,
		EntityID: task.ID,
		Title:    task.Name,
		Body:     task.Description,
	})
}

func (i *indexer) IndexProject(project *models.Project) {
	if project == nil || project.WorkspaceID == nil || *project.WorkspaceID == "" {
		return
	}
	var userID string
	if err := i.db.Table("workspaces").Select("user_id").Where("id = ?", *project.WorkspaceID).Scan(&userID).Error; err != nil || userID == "" {
		return
	}
	i.upsertAsync(Document{
		UserID:   userID,
		Kind:     KindProject,
		EntityID: project.ID,
		Title:    project.Title,
		Body:     project.Description,
	})
}

func (i *indexer) IndexDoc(doc *models.Document) {
	if doc == nil || doc.UserID == "" {
		return
	}
	i.upsertAsync(Document{
		UserID:   doc.UserID,
		Kind:     KindDoc,
		EntityID: doc.ID,
		Title:    doc.Title,
		Body:     DocBody(doc),
	})
}

func (i *indexer) IndexSheet(sheet *models.Sheet) {
	if sheet == nil || sheet.UserID == "" {
		return
	}
	i.upsertAsync(Document{
		UserID:   sheet.UserID,
		Kind:     KindSheet,
		EntityID: sheet.ID,
		Title:    sheet.Title,
		Body:     FlattenSheet(sheet),
	})
}

func (i *indexer) IndexEvent(event *models.Event) {
	if event == nil || event.UserID == "" {
		return
	}
	i.upsertAsync(Document{
		UserID:   event.UserID,
		Kind:     KindEvent,
		EntityID: event.ID,
		Title:    event.Title,
		Body:     event.Description,
	})
}

func (i *indexer) upsertAsync(doc Document) {
	if !i.Enabled() {
		return
	}
	if i.queue != nil {
		if err := i.queue.EnqueueIndex(doc.UserID, doc.Kind, doc.EntityID, doc.Title, doc.Body); err != nil {
			log.Printf("embed enqueue %s/%s: %v", doc.Kind, doc.EntityID, err)
		}
		return
	}
	go func() {
		var lastErr error
		for attempt := 0; attempt < 4; attempt++ {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			lastErr = i.upsert(ctx, doc)
			cancel()
			if lastErr == nil {
				return
			}
			time.Sleep(time.Duration(1<<attempt) * time.Second)
		}
		log.Printf("embed upsert %s/%s failed after retries: %v", doc.Kind, doc.EntityID, lastErr)
	}()
}

func (i *indexer) Delete(userID, kind, entityID string) {
	if userID == "" || kind == "" || entityID == "" {
		return
	}
	if err := i.db.Where("user_id = ? AND entity_kind = ? AND entity_id = ?", userID, kind, entityID).
		Delete(&models.Embedding{}).Error; err != nil {
		log.Printf("embed delete %s/%s: %v", kind, entityID, err)
	}
	i.vectors.invalidate(userID)
}
