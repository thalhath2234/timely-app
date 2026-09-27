package agent

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"timely-api/internal/features/portability"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) portable() (*portability.Service, error) {
	if s.Portable == nil {
		return nil, errors.New("export is not available")
	}
	return s.Portable, nil
}

func (s *Server) exportAccount(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	backup, err := svc.Export(uid)
	if err != nil {
		return fail(err)
	}
	counts := map[string]int{}
	for name, rows := range backup.Rows {
		counts[name] = len(rows)
	}
	return reply("exported account", map[string]any{
		"format":        backup.Format,
		"schemaVersion": backup.SchemaVersion,
		"exportedAt":    backup.ExportedAt,
		"counts":        counts,
		"backup":        backup,
	})
}

func (s *Server) exportTasksCSV(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	data, err := svc.TasksCSV(uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("tasks csv (%d bytes)", len(data)), map[string]any{"csv": string(data)})
}

func (s *Server) exportCalendar(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	data, err := svc.CalendarICS(uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("calendar ics (%d bytes)", len(data)), map[string]any{"ics": string(data)})
}

type exportDocIn struct {
	DocID  string `json:"docId"`
	Format string `json:"format,omitempty" jsonschema:"markdown (default) or pdf"`
}

func (s *Server) exportDoc(ctx context.Context, req *mcp.CallToolRequest, in exportDocIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	format := in.Format
	if format == "" {
		format = "markdown"
	}
	data, filename, contentType, err := svc.DocumentExport(uid, in.DocID, format)
	if err != nil {
		return fail(err)
	}
	out := map[string]any{
		"filename":    filename,
		"contentType": contentType,
	}
	if contentType == "application/pdf" {
		out["pdfBase64"] = base64.StdEncoding.EncodeToString(data)
	} else {
		out["markdown"] = string(data)
	}
	return reply("exported "+filename, out)
}

func (s *Server) getBackupSettings(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	settings, err := svc.GetSettings(uid)
	if err != nil {
		return fail(err)
	}
	return reply("backup settings", settings)
}

type backupSettingsIn struct {
	Enabled        *bool `json:"enabled,omitempty"`
	IntervalDays   *int  `json:"intervalDays,omitempty"`
	RetentionCount *int  `json:"retentionCount,omitempty"`
}

func (s *Server) updateBackupSettings(ctx context.Context, req *mcp.CallToolRequest, in backupSettingsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	current, err := svc.GetSettings(uid)
	if err != nil {
		return fail(err)
	}
	if in.Enabled != nil {
		current.Enabled = *in.Enabled
	}
	if in.IntervalDays != nil {
		current.IntervalDays = *in.IntervalDays
	}
	if in.RetentionCount != nil {
		current.RetentionCount = *in.RetentionCount
	}
	updated, err := svc.UpdateSettings(uid, current)
	if err != nil {
		return fail(err)
	}
	return reply("backup settings saved", updated)
}

func (s *Server) createBackup(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	row, err := svc.CreateEncrypted(uid)
	if err != nil {
		return fail(err)
	}
	return reply("backup created", row)
}

func (s *Server) listBackups(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	rows, err := svc.List(uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d backups", len(rows)), map[string]any{"items": rows})
}

type backupIDIn struct {
	BackupID string `json:"backupId"`
}

func (s *Server) downloadBackup(ctx context.Context, req *mcp.CallToolRequest, in backupIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	plain, row, err := svc.Read(uid, in.BackupID)
	if err != nil {
		return fail(err)
	}
	var backup any
	if err := json.Unmarshal(plain, &backup); err != nil {
		return fail(err)
	}
	return reply("backup downloaded", map[string]any{"file": row, "backup": backup})
}

type deleteBackupIn struct {
	BackupID string `json:"backupId"`
	Confirm  bool   `json:"confirm,omitempty"`
}

func (s *Server) deleteBackup(ctx context.Context, req *mcp.CallToolRequest, in deleteBackupIn) (*mcp.CallToolResult, any, error) {
	if err := confirmOrFail(in.Confirm, "delete this backup"); err != nil {
		return fail(err)
	}
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	if err := svc.Delete(uid, in.BackupID); err != nil {
		return fail(err)
	}
	return reply("backup deleted", map[string]string{"id": in.BackupID})
}

type restoreIn struct {
	Confirm bool           `json:"confirm"`
	Backup  map[string]any `json:"backup"`
}

func (s *Server) restoreAccount(ctx context.Context, req *mcp.CallToolRequest, in restoreIn) (*mcp.CallToolResult, any, error) {
	if err := confirmOrFail(in.Confirm, "replace this account with the backup"); err != nil {
		return fail(err)
	}
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.portable()
	if err != nil {
		return fail(err)
	}
	raw, err := json.Marshal(in.Backup)
	if err != nil {
		return fail(err)
	}
	var backup portability.Backup
	if err := json.Unmarshal(raw, &backup); err != nil {
		return fail(err)
	}
	result, err := svc.Restore(uid, &backup)
	if err != nil {
		return fail(err)
	}
	return reply("account restored", result)
}
