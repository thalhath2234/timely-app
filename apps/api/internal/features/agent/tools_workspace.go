package agent

import (
	"context"
	"errors"
	"fmt"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) listWorkspaces(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	workspaces, err := s.Workspaces.GetAllWorkspaceByUser(uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d workspaces", len(workspaces)), map[string]any{"workspaces": workspaces})
}

type workspaceIDIn struct {
	WorkspaceID string `json:"workspaceId"`
}

func (s *Server) getWorkspace(ctx context.Context, req *mcp.CallToolRequest, in workspaceIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	ws, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID)
	if err != nil {
		return fail(err)
	}
	return reply(ws.Name, ws)
}

type createWorkspaceIn struct {
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
}

// createWorkspace creates a workspace with an optional color for the caller.
func (s *Server) createWorkspace(ctx context.Context, req *mcp.CallToolRequest, in createWorkspaceIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	ws, err := s.Workspaces.Create(&models.Workspace{Name: in.Name, Color: in.Color, UserID: &uid})
	if err != nil {
		return fail(err)
	}
	full, err := s.Workspaces.GetWorkspaceById(uid, ws.ID)
	if err != nil {
		return reply("created "+ws.Name, ws)
	}
	return reply("created "+full.Name, full)
}

type renameWorkspaceIn struct {
	WorkspaceID string  `json:"workspaceId"`
	Name        string  `json:"name"`
	Color       *string `json:"color,omitempty"`
}

// renameWorkspace updates the name and optional color of a workspace owned by the caller.
func (s *Server) renameWorkspace(ctx context.Context, req *mcp.CallToolRequest, in renameWorkspaceIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	ws, err := s.Workspaces.UpdateWorkspace(uid, in.WorkspaceID, in.Name, in.Color)
	if err != nil {
		return fail(err)
	}
	return reply("renamed to "+ws.Name, ws)
}

type deleteWorkspaceIn struct {
	WorkspaceID string `json:"workspaceId"`
	Confirm     bool   `json:"confirm"`
}

func (s *Server) deleteWorkspace(ctx context.Context, req *mcp.CallToolRequest, in deleteWorkspaceIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if err := confirmOrFail(in.Confirm, "delete this workspace"); err != nil {
		return fail(err)
	}
	if err := s.Workspaces.Delete(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	return reply("workspace deleted", map[string]string{"id": in.WorkspaceID})
}

type namedColorIn struct {
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
	Color       string `json:"color,omitempty"`
}

func (s *Server) createStatus(ctx context.Context, req *mcp.CallToolRequest, in namedColorIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	status, err := s.Workspaces.CreateStatuses(&models.Status{
		Name:        in.Name,
		Color:       in.Color,
		WorkspaceID: in.WorkspaceID,
	})
	if err != nil {
		return fail(err)
	}
	return reply("created status "+status.Name, status)
}

type updateNamedIn struct {
	WorkspaceID string `json:"workspaceId"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Color       string `json:"color,omitempty"`
}

func (s *Server) updateStatus(ctx context.Context, req *mcp.CallToolRequest, in updateNamedIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	status, err := s.Workspaces.UpdateStatuses(&models.Status{
		ID:          in.ID,
		Name:        in.Name,
		Color:       in.Color,
		WorkspaceID: in.WorkspaceID,
	})
	if err != nil {
		return fail(err)
	}
	return reply("updated status "+status.Name, status)
}

type deleteNamedIn struct {
	WorkspaceID string `json:"workspaceId"`
	ID          string `json:"id"`
}

func (s *Server) deleteStatus(ctx context.Context, req *mcp.CallToolRequest, in deleteNamedIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	if err := s.Workspaces.DeleteStatuses(in.ID, in.WorkspaceID); err != nil {
		return fail(err)
	}
	return reply("status deleted", map[string]string{"id": in.ID})
}

func (s *Server) createLabel(ctx context.Context, req *mcp.CallToolRequest, in namedColorIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	label, err := s.Workspaces.CreateLables(&models.Lable{
		Name:        in.Name,
		Color:       in.Color,
		WorkspaceID: in.WorkspaceID,
	})
	if err != nil {
		return fail(err)
	}
	return reply("created label "+label.Name, label)
}

func (s *Server) updateLabel(ctx context.Context, req *mcp.CallToolRequest, in updateNamedIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	label, err := s.Workspaces.UpdateLables(&models.Lable{
		ID:          in.ID,
		Name:        in.Name,
		Color:       in.Color,
		WorkspaceID: in.WorkspaceID,
	})
	if err != nil {
		return fail(err)
	}
	return reply("updated label "+label.Name, label)
}

func (s *Server) deleteLabel(ctx context.Context, req *mcp.CallToolRequest, in deleteNamedIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	if err := s.Workspaces.DeleteLables(in.ID, in.WorkspaceID); err != nil {
		return fail(err)
	}
	return reply("label deleted", map[string]string{"id": in.ID})
}

type optionIn struct {
	Value string `json:"value"`
	Color string `json:"color,omitempty"`
}

type createCFIn struct {
	WorkspaceID string     `json:"workspaceId"`
	Name        string     `json:"name"`
	Type        string     `json:"type" jsonschema:"text, select, multi_select, number, url, date, or boolean"`
	Options     []optionIn `json:"options,omitempty"`
}

func cfOptions(in []optionIn) models.Options {
	opts := models.Options{Options: []models.Option{}}
	for _, item := range in {
		opts.Options = append(opts.Options, models.Option{
			ID:    utils.NewOptionID(),
			Value: item.Value,
			Color: item.Color,
		})
	}
	return opts
}

func (s *Server) createCustomField(ctx context.Context, req *mcp.CallToolRequest, in createCFIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	field, err := s.Workspaces.CreateCustomFields(&models.CustomField{
		Name:        in.Name,
		Type:        models.CustomFieldType(in.Type),
		WorkspaceID: in.WorkspaceID,
		Options:     cfOptions(in.Options),
	})
	if err != nil {
		return fail(err)
	}
	return reply("created custom field "+field.Name, field)
}

type updateCFIn struct {
	WorkspaceID string     `json:"workspaceId"`
	ID          string     `json:"id"`
	Name        string     `json:"name,omitempty"`
	Type        string     `json:"type,omitempty"`
	Options     []optionIn `json:"options,omitempty"`
}

func (s *Server) updateCustomField(ctx context.Context, req *mcp.CallToolRequest, in updateCFIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	ws, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID)
	if err != nil {
		return fail(err)
	}
	var existing *models.CustomField
	for _, field := range ws.CustomFields {
		if field != nil && field.ID == in.ID {
			existing = field
			break
		}
	}
	if existing == nil {
		return fail(errors.New("custom field not found"))
	}
	name := in.Name
	if name == "" {
		name = existing.Name
	}
	cfType := models.CustomFieldType(in.Type)
	if cfType == "" {
		cfType = existing.Type
	}
	options := existing.Options
	if in.Options != nil {
		options = cfOptions(in.Options)
	}
	field, err := s.Workspaces.UpdateCustomFields(&models.CustomField{
		ID:          in.ID,
		Name:        name,
		Type:        cfType,
		WorkspaceID: in.WorkspaceID,
		Options:     options,
	})
	if err != nil {
		return fail(err)
	}
	return reply("updated custom field "+field.Name, field)
}

func (s *Server) deleteCustomField(ctx context.Context, req *mcp.CallToolRequest, in deleteNamedIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if _, err := s.Workspaces.GetWorkspaceById(uid, in.WorkspaceID); err != nil {
		return fail(err)
	}
	if err := s.Workspaces.DeleteCustomFields(in.ID, in.WorkspaceID); err != nil {
		return fail(err)
	}
	return reply("custom field deleted", map[string]string{"id": in.ID})
}
