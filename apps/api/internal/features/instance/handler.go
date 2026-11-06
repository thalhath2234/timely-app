// Package instance reports what this API process is: its version, where it
// listens and where it writes files. GET /health is public so a phone can
// probe candidate URLs; GET /instance is for a signed-in person's Settings →
// Server screen. The JSON shapes are the contract in docs/desktop/README.md.
package instance

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"runtime"
	"sync"
	"time"

	"timely-api/internal/buildinfo"
	"timely-api/internal/database"

	"github.com/labstack/echo/v5"
)

// Config is everything main knows about this process that the handlers report.
type Config struct {
	Port              int
	Bind              []string
	DataDir           string
	BackupDir         string
	AllowRegistration bool
	LocalCLI          bool
	// RegistrationOpen reports whether POST /register would accept an account
	// right now (allowed, or no account exists yet).
	RegistrationOpen func() bool
}

type Handler struct {
	cfg Config
	db  *sql.DB

	mu         sync.RWMutex
	listening  []string
	instanceID string
}

func NewHandler(cfg Config, db *sql.DB) *Handler {
	return &Handler{cfg: cfg, db: db}
}

// SetListening records the addresses that actually bound, after main
// started the listeners.
func (h *Handler) SetListening(addrs []string) {
	h.mu.Lock()
	h.listening = append([]string(nil), addrs...)
	h.mu.Unlock()
}

func (h *Handler) Listening() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return append([]string(nil), h.listening...)
}

func (h *Handler) registrationOpen() bool {
	if h.cfg.RegistrationOpen != nil {
		return h.cfg.RegistrationOpen()
	}
	return h.cfg.AllowRegistration
}

// InstanceID is this server's id from server_identity; phones pin it when
// they pair. Read once: the row never changes.
func (h *Handler) InstanceID(ctx context.Context) (string, error) {
	h.mu.RLock()
	id := h.instanceID
	h.mu.RUnlock()
	if id != "" || h.db == nil {
		return id, nil
	}
	if err := h.db.QueryRowContext(ctx, `SELECT id FROM server_identity LIMIT 1`).Scan(&id); err != nil {
		return "", err
	}
	h.mu.Lock()
	h.instanceID = id
	h.mu.Unlock()
	return id, nil
}

type healthResponse struct {
	Status           string                  `json:"status"`
	InstanceID       string                  `json:"instanceId,omitempty"`
	Version          string                  `json:"version"`
	DB               string                  `json:"db"`
	Migrations       database.MigrationState `json:"migrations"`
	RegistrationOpen bool                    `json:"registrationOpen"`
	UptimeSeconds    int64                   `json:"uptimeSeconds"`
}

// Health pings the database and reports migration state; 503 when the ping
// fails so a supervisor or the phone can tell "up" from "healthy".
func (h *Handler) Health(c *echo.Context) error {
	ctx := c.Request().Context()
	out := healthResponse{
		Status:           "ok",
		Version:          buildinfo.Version,
		DB:               "ok",
		RegistrationOpen: h.registrationOpen(),
		UptimeSeconds:    buildinfo.UptimeSeconds(),
	}
	if h.db == nil {
		out.Status, out.DB = "degraded", "no database"
		return c.JSON(http.StatusServiceUnavailable, out)
	}
	// /health is public, so driver errors (host, user, database name) go to
	// the log, not the response.
	if err := database.Ping(ctx, h.db); err != nil {
		log.Printf("health: database ping failed: %v", err)
		out.Status, out.DB = "degraded", "unreachable"
		return c.JSON(http.StatusServiceUnavailable, out)
	}
	stateCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if state, err := database.Migrations(stateCtx, h.db); err == nil {
		out.Migrations = state
	} else {
		log.Printf("health: reading migrations failed: %v", err)
		out.Status, out.DB = "degraded", "migrations unavailable"
		return c.JSON(http.StatusServiceUnavailable, out)
	}
	if id, err := h.InstanceID(stateCtx); err == nil {
		out.InstanceID = id
	} else {
		log.Printf("health: reading the instance id failed: %v", err)
	}
	return c.JSON(http.StatusOK, out)
}

type instanceResponse struct {
	InstanceID        string   `json:"instanceId,omitempty"`
	Version           string   `json:"version"`
	Platform          string   `json:"platform"`
	StartedAt         string   `json:"startedAt"`
	Port              int      `json:"port"`
	Bind              []string `json:"bind"`
	Listening         []string `json:"listening"`
	DataDir           string   `json:"dataDir"`
	BackupDir         string   `json:"backupDir"`
	AllowRegistration bool     `json:"allowRegistration"`
	RegistrationOpen  bool     `json:"registrationOpen"`
	LocalCLI          bool     `json:"localCli"`
}

// Instance describes the running process for Settings → Server.
func (h *Handler) Instance(c *echo.Context) error {
	bind := h.cfg.Bind
	if bind == nil {
		bind = []string{}
	}
	id, _ := h.InstanceID(c.Request().Context())
	return c.JSON(http.StatusOK, instanceResponse{
		InstanceID:        id,
		Version:           buildinfo.Version,
		Platform:          runtime.GOOS + "/" + runtime.GOARCH,
		StartedAt:         buildinfo.StartedAt.UTC().Format(time.RFC3339),
		Port:              h.cfg.Port,
		Bind:              bind,
		Listening:         h.Listening(),
		DataDir:           h.cfg.DataDir,
		BackupDir:         h.cfg.BackupDir,
		AllowRegistration: h.cfg.AllowRegistration,
		RegistrationOpen:  h.registrationOpen(),
		LocalCLI:          h.cfg.LocalCLI,
	})
}
