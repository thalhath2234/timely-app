// Package instance reports what this API process is: its version, where it
// listens and where it writes files. GET /health is public so a phone can
// probe candidate URLs; GET /instance is for a signed-in person's Settings →
// Server screen. The JSON shapes are the contract in docs/desktop/README.md.
package instance

import (
	"context"
	"database/sql"
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

	mu        sync.RWMutex
	listening []string
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

type healthResponse struct {
	Status           string                  `json:"status"`
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
	if err := database.Ping(ctx, h.db); err != nil {
		out.Status, out.DB = "degraded", err.Error()
		return c.JSON(http.StatusServiceUnavailable, out)
	}
	stateCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if state, err := database.Migrations(stateCtx, h.db); err == nil {
		out.Migrations = state
	} else {
		out.Status, out.DB = "degraded", err.Error()
		return c.JSON(http.StatusServiceUnavailable, out)
	}
	return c.JSON(http.StatusOK, out)
}

type instanceResponse struct {
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
	return c.JSON(http.StatusOK, instanceResponse{
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
