package doc

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/realtime"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

type Handler struct {
	documentService DocumentService
	live            *realtime.Hub
}

func NewHandler(documentService DocumentService, live *realtime.Hub) *Handler {
	return &Handler{documentService: documentService, live: live}
}

type createDocumentRequest struct {
	Title       string          `json:"title"`
	Icon        *string         `json:"icon"`
	Content     *models.JSONMap `json:"content"`
	PlainText   string          `json:"plainText"`
	ParentID    *string         `json:"parentId"`
	WorkspaceID string          `json:"workspaceId"`
	ProjectID   *string         `json:"projectId"`
}

// updateDocumentRequest uses pointers so an omitted field is distinguishable
// from one explicitly cleared by the client.
type updateDocumentRequest struct {
	Title      *string         `json:"title"`
	Icon       *string         `json:"icon"`
	Content    *models.JSONMap `json:"content"`
	PlainText  *string         `json:"plainText"`
	ParentID   *string         `json:"parentId"`
	ProjectID  *string         `json:"projectId"`
	IsFavorite *bool           `json:"isFavorite"`
	Archived   *bool           `json:"archived"`
	Order      *int            `json:"order"`
}

func (h *Handler) Create(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req createDocumentRequest
	if err := decodeJSON(c, &req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	document := &models.Document{
		Title:       req.Title,
		Icon:        req.Icon,
		PlainText:   req.PlainText,
		ParentID:    req.ParentID,
		WorkspaceID: req.WorkspaceID,
		ProjectID:   req.ProjectID,
		UserID:      userID,
	}

	if req.Content != nil {
		document.Content = *req.Content
	}

	createdDocument, err := h.documentService.Create(document)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"message":  "document created successfully",
		"document": createdDocument,
	})
}

func (h *Handler) GetAllDocumentsByUser(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	filter := DocumentFilter{
		WorkspaceID: c.QueryParam("workspaceId"),
		ProjectID:   c.QueryParam("projectId"),
		Text:        c.QueryParam("q"),
		Archived:    parseBoolQuery(c.QueryParam("archived")),
		Favorite:    parseBoolQuery(c.QueryParam("favorite")),
	}
	if parent, ok := c.QueryParams()["parentId"]; ok {
		value := ""
		if len(parent) > 0 {
			value = parent[0]
		}
		filter.ParentID = &value
	}

	documents, err := h.documentService.List(userID, filter)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, documents)
}

func (h *Handler) GetDocumentById(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	document, err := h.documentService.GetByID(userID, c.Param("id"))
	if err != nil {
		return documentError(err)
	}

	return c.JSON(http.StatusOK, document)
}

func (h *Handler) Update(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	var req updateDocumentRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request payload")
	}

	// Some clients historically sent the tree as descriptionRich. Accept both.
	if req.Content == nil {
		if content, ok := rawJSONField(body, "content"); ok {
			req.Content = content
		} else if rich, ok := rawJSONField(body, "descriptionRich"); ok {
			req.Content = rich
		}
	}

	document, err := h.documentService.Update(userID, c.Param("id"), DocumentUpdate{
		Title:      req.Title,
		Icon:       req.Icon,
		Content:    req.Content,
		PlainText:  req.PlainText,
		ParentID:   req.ParentID,
		ProjectID:  req.ProjectID,
		IsFavorite: req.IsFavorite,
		Archived:   req.Archived,
		Order:      req.Order,
	})
	if err != nil {
		return documentError(err)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"message":  "document updated successfully",
		"document": document,
	})
}

func (h *Handler) Delete(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	if err := h.documentService.Delete(userID, c.Param("id")); err != nil {
		return documentError(err)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"message": "document deleted successfully",
	})
}

// Watch is an SSE stream of last-write-wins invalidations for one document.
// Auth is the same as the rest of the API: session cookie (web) or Bearer (mobile).
func (h *Handler) Watch(c *echo.Context) error {
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if h.live == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "realtime unavailable")
	}

	documentID := c.Param("id")
	if _, err := h.documentService.GetByID(userID, documentID); err != nil {
		return documentError(err)
	}

	w := c.Response()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	events, cancel := h.live.Subscribe(userID, documentID)
	defer cancel()

	if err := writeSSE(w, realtime.Event{Type: "hello", Kind: "doc", ID: documentID}); err != nil {
		return nil
	}

	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	ctx := c.Request().Context()
	for {
		select {
		case <-ctx.Done():
			return nil
		case ev, ok := <-events:
			if !ok {
				return nil
			}
			if err := writeSSE(w, ev); err != nil {
				return nil
			}
		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return nil
			}
			flushWriter(w)
		}
	}
}

func writeSSE(w http.ResponseWriter, event realtime.Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, payload); err != nil {
		return err
	}
	flushWriter(w)
	return nil
}

func flushWriter(w http.ResponseWriter) {
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
		return
	}
	_ = http.NewResponseController(w).Flush()
}

func decodeJSON(c *echo.Context, dest any) error {
	if err := c.Bind(dest); err != nil {
		return err
	}
	return nil
}

func rawJSONField(body []byte, key string) (*models.JSONMap, bool) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, false
	}
	value, ok := raw[key]
	if !ok || string(value) == "null" {
		return nil, false
	}
	var parsed models.JSONMap
	if err := json.Unmarshal(value, &parsed); err != nil {
		return nil, false
	}
	return &parsed, true
}

func documentError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "document not found")
	}
	return echo.NewHTTPError(http.StatusBadRequest, err.Error())
}

func parseBoolQuery(raw string) *bool {
	switch raw {
	case "true", "1":
		v := true
		return &v
	case "false", "0":
		v := false
		return &v
	default:
		return nil
	}
}
