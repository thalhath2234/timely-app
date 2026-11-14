package instance

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v5"
)

// SetStore gives the handler the instance_settings store behind
// GET /instance/settings and the two desktop-only PUT routes.
func (h *Handler) SetStore(s *Store) {
	h.mu.Lock()
	h.store = s
	h.mu.Unlock()
}

func (h *Handler) settingsStore() *Store {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.store
}

// Routes mounts the instance settings routes. auth is the sign-in middleware
// (the JWT one main already uses). The two PUT routes check the shell token
// before sign-in, so anyone but the desktop window gets 404, not 401.
func (h *Handler) Routes(e *echo.Echo, auth echo.MiddlewareFunc) {
	e.GET("/instance/settings", h.Settings, auth)
	e.PUT("/instance/host-accounts", h.PutHostAccounts, ShellOnly, auth)
	e.PUT("/instance/agent-limits", h.PutAgentLimits, ShellOnly, auth)
}

// SettingsAccount is one host-allowed account in GET /instance/settings.
type SettingsAccount struct {
	UID        string `json:"uid"`
	Email      string `json:"email"`
	WorkingDir string `json:"workingDir"`
	Source     string `json:"source"`
}

// SettingsResponse is the contract in packages/contract/src/instanceSettings.ts.
type SettingsResponse struct {
	HostAccounts []SettingsAccount `json:"hostAccounts"`
	// OtherHostAccounts counts the host-allowed accounts that are not the
	// signed-in one. Outside the desktop window the list above holds the
	// signed-in account's own row only: other accounts' emails and folders
	// are not another account's to read (ADR 0001, phase 5).
	OtherHostAccounts      int    `json:"otherHostAccounts"`
	ThisAccountHostAllowed bool   `json:"thisAccountHostAllowed"`
	ThisAccountWorkingDir  string `json:"thisAccountWorkingDir"`
	MaxWorkers             int    `json:"maxWorkers"`
	IdleMinutes            int    `json:"idleMinutes"`
	// Shell is true when this very request came from the desktop window, the
	// only place these settings can be changed.
	Shell bool `json:"shell"`
}

func signedInUser(c *echo.Context) string {
	uid, _ := c.Get("userID").(string)
	return uid
}

func (h *Handler) settings(c *echo.Context, store *Store) (SettingsResponse, error) {
	ctx := c.Request().Context()
	uid := signedInUser(c)
	accounts, err := store.HostAccounts(ctx)
	if err != nil {
		return SettingsResponse{}, err
	}
	shell := ShellRequest(c)
	emails := h.emailsOf(ctx, accounts)
	out := SettingsResponse{HostAccounts: []SettingsAccount{}, Shell: shell}
	for _, a := range accounts {
		if a.UID == uid {
			out.ThisAccountHostAllowed = true
			out.ThisAccountWorkingDir = a.WorkingDir
		} else {
			out.OtherHostAccounts++
		}
		if shell || a.UID == uid {
			// Only the desktop window sees every account's email and folder.
			out.HostAccounts = append(out.HostAccounts, SettingsAccount{UID: a.UID, Email: emails[a.UID], WorkingDir: a.WorkingDir, Source: a.Source})
		}
	}
	limits, err := store.AgentLimits(ctx)
	if err != nil {
		return SettingsResponse{}, err
	}
	out.MaxWorkers, out.IdleMinutes = limits.MaxWorkers, limits.IdleMinutes
	return out, nil
}

func (h *Handler) emailsOf(ctx context.Context, accounts []HostAccount) map[string]string {
	emails := map[string]string{}
	if h.db == nil || len(accounts) == 0 {
		return emails
	}
	args := make([]any, len(accounts))
	marks := make([]string, len(accounts))
	for i, a := range accounts {
		args[i] = a.UID
		marks[i] = "$" + strconv.Itoa(i+1)
	}
	rows, err := h.db.QueryContext(ctx, `SELECT id, email FROM users WHERE id IN (`+strings.Join(marks, ",")+`)`, args...)
	if err != nil {
		log.Printf("instance: reading account emails: %v", err)
		return emails
	}
	defer rows.Close()
	for rows.Next() {
		var id, email string
		if rows.Scan(&id, &email) == nil {
			emails[id] = email
		}
	}
	return emails
}

// Settings is GET /instance/settings: who may use this computer, the worker
// limits, and whether this request is the desktop window.
func (h *Handler) Settings(c *echo.Context) error {
	store := h.settingsStore()
	if store == nil {
		return echo.ErrNotFound
	}
	out, err := h.settings(c, store)
	if err != nil {
		log.Printf("instance: settings: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Could not read the instance settings")
	}
	return c.JSON(http.StatusOK, out)
}

type hostAccountBody struct {
	UID        string  `json:"uid"`
	On         *bool   `json:"on"`
	WorkingDir *string `json:"workingDir"`
}

func decodeStrict(c *echo.Context, into any) error {
	dec := json.NewDecoder(http.MaxBytesReader(c.Response(), c.Request().Body, 8<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "That request isn't valid")
	}
	return nil
}

func saveError(err error) error {
	if errors.Is(err, ErrInvalid) {
		msg := strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": ")
		return echo.NewHTTPError(http.StatusBadRequest, msg)
	}
	log.Printf("instance: save: %v", err)
	return echo.NewHTTPError(http.StatusInternalServerError, "Could not save that")
}

// PutHostAccounts is PUT /instance/host-accounts {uid, on?, workingDir?},
// desktop window only. The uid must be the signed-in account: turning on
// another account means signing in as it in the desktop window.
func (h *Handler) PutHostAccounts(c *echo.Context) error {
	store := h.settingsStore()
	if store == nil {
		return echo.ErrNotFound
	}
	var body hostAccountBody
	if err := decodeStrict(c, &body); err != nil {
		return err
	}
	if body.UID == "" || body.UID != signedInUser(c) {
		return echo.NewHTTPError(http.StatusForbidden, "Sign in as that account in the desktop app to change it")
	}
	if body.On == nil && body.WorkingDir == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Nothing to change")
	}
	if err := store.SetHostAccount(c.Request().Context(), body.UID, body.On, body.WorkingDir); err != nil {
		return saveError(err)
	}
	if body.On != nil {
		log.Printf("instance: host tools for account %s turned %s in the desktop window", body.UID, map[bool]string{true: "on", false: "off"}[*body.On])
	}
	out, err := h.settings(c, store)
	if err != nil {
		return saveError(err)
	}
	return c.JSON(http.StatusOK, out)
}

type agentLimitsBody struct {
	MaxWorkers  int `json:"maxWorkers"`
	IdleMinutes int `json:"idleMinutes"`
}

// PutAgentLimits is PUT /instance/agent-limits {maxWorkers, idleMinutes},
// desktop window only.
func (h *Handler) PutAgentLimits(c *echo.Context) error {
	store := h.settingsStore()
	if store == nil {
		return echo.ErrNotFound
	}
	var body agentLimitsBody
	if err := decodeStrict(c, &body); err != nil {
		return err
	}
	if err := store.SetAgentLimits(c.Request().Context(), AgentLimits{MaxWorkers: body.MaxWorkers, IdleMinutes: body.IdleMinutes}); err != nil {
		return saveError(err)
	}
	out, err := h.settings(c, store)
	if err != nil {
		return saveError(err)
	}
	return c.JSON(http.StatusOK, out)
}
