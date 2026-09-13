package portability

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

func accountID(c *echo.Context) (string, error) {
	id, ok := c.Get("userID").(string)
	if !ok || id == "" {
		return "", echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	return id, nil
}

func portableError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) || os.IsNotExist(err) {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	return echo.NewHTTPError(http.StatusBadRequest, err.Error())
}

func attachment(c *echo.Context, data []byte, filename, contentType string) error {
	c.Response().Header().Set(echo.HeaderContentType, contentType)
	c.Response().Header().Set(echo.HeaderContentDisposition, fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(filename, `"`, "")))
	c.Response().Header().Set(echo.HeaderCacheControl, "no-store")
	return c.Blob(http.StatusOK, contentType, data)
}

func (h *Handler) ExportFull(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	backup, err := h.service.Export(uid)
	if err != nil {
		return portableError(err)
	}
	data, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return portableError(err)
	}
	return attachment(c, data, "timely-backup-"+time.Now().UTC().Format("2006-01-02")+".json", "application/json; charset=utf-8")
}

func (h *Handler) Restore(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	if c.QueryParam("mode") != "replace" || c.Request().Header.Get("X-Timely-Restore") != "replace" {
		return echo.NewHTTPError(http.StatusPreconditionRequired, "replace confirmation is required")
	}
	decoder := json.NewDecoder(io.LimitReader(c.Request().Body, 50<<20))
	decoder.DisallowUnknownFields()
	var backup Backup
	if err := decoder.Decode(&backup); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid backup file")
	}
	result, err := h.service.Restore(uid, &backup)
	if err != nil {
		return portableError(err)
	}
	return c.JSON(http.StatusOK, result)
}

func (h *Handler) ExportTasks(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	data, err := h.service.TasksCSV(uid)
	if err != nil {
		return portableError(err)
	}
	return attachment(c, data, "timely-tasks-"+time.Now().UTC().Format("2006-01-02")+".csv", "text/csv; charset=utf-8")
}

func (h *Handler) ExportCalendar(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	data, err := h.service.CalendarICS(uid)
	if err != nil {
		return portableError(err)
	}
	return attachment(c, data, "timely-calendar.ics", "text/calendar; charset=utf-8")
}

func (h *Handler) ExportDocument(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	data, filename, contentType, err := h.service.DocumentExport(uid, c.Param("id"), c.QueryParam("format"))
	if err != nil {
		return portableError(err)
	}
	return attachment(c, data, filename, contentType)
}

func (h *Handler) GetSettings(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	settings, err := h.service.GetSettings(uid)
	if err != nil {
		return portableError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func (h *Handler) UpdateSettings(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	var input models.BackupSettings
	if err := c.Bind(&input); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid settings")
	}
	settings, err := h.service.UpdateSettings(uid, input)
	if err != nil {
		return portableError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func (h *Handler) CreateBackup(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	row, err := h.service.CreateEncrypted(uid)
	if err != nil {
		return portableError(err)
	}
	return c.JSON(http.StatusCreated, row)
}

func (h *Handler) ListBackups(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	rows, err := h.service.List(uid)
	if err != nil {
		return portableError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"items": rows})
}

func (h *Handler) DownloadBackup(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	data, row, err := h.service.Read(uid, c.Param("id"))
	if err != nil {
		return portableError(err)
	}
	return attachment(c, data, "timely-backup-"+row.CreatedAt.UTC().Format("2006-01-02-150405")+".json", "application/json; charset=utf-8")
}

func (h *Handler) DeleteBackup(c *echo.Context) error {
	uid, err := accountID(c)
	if err != nil {
		return err
	}
	if err := h.service.Delete(uid, c.Param("id")); err != nil {
		return portableError(err)
	}
	return c.NoContent(http.StatusNoContent)
}
