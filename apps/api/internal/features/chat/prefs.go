package chat

import (
	"errors"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/agent"
)

// Per-account chat settings (Q-2.2, Q-P1): Settings → Agent → Engine
// (Classic or New, default Classic) and the permission defaults (new chats
// Supervised, bots Auto, Full Access allowed on this desktop only).

// AgentChatSettings is one account's row; a missing row reads as defaults.
type AgentChatSettings struct {
	UserID              string    `gorm:"primaryKey" json:"-"`
	Engine              string    `gorm:"not null;default:'classic'" json:"engine"`
	ChatPermission      string    `gorm:"not null;default:'supervised'" json:"chatPermission"`
	BotPermission       string    `gorm:"not null;default:'auto'" json:"botPermission"`
	FullAccessAllowedOn string    `gorm:"not null;default:'desktop'" json:"fullAccessAllowedOn"`
	CreatedAt           time.Time `json:"-"`
	UpdatedAt           time.Time `json:"-"`
}

func (AgentChatSettings) TableName() string { return "agent_chat_settings" }

// Where Full Access may be turned on: the desktop app only, or any device.
const (
	allowedOnDesktop = "desktop"
	allowedOnDevices = "devices"
)

func defaultChatSettings(uid string) AgentChatSettings {
	return AgentChatSettings{UserID: uid, Engine: engineClassic, ChatPermission: string(agent.Supervised), BotPermission: string(agent.Auto), FullAccessAllowedOn: allowedOnDesktop}
}

// chatSettings reads the account's settings, defaults where none are saved.
func chatSettings(db *gorm.DB, uid string) (AgentChatSettings, error) {
	prefs := defaultChatSettings(uid)
	var rows []AgentChatSettings
	if err := db.Where("user_id = ?", uid).Limit(1).Find(&rows).Error; err != nil {
		return prefs, err
	}
	if len(rows) == 1 {
		prefs = rows[0]
	}
	return prefs, nil
}

// chatSettingsOut is the wire form, with whether the agent engine can run
// for the account now and why not.
type chatSettingsOut struct {
	AgentChatSettings
	EngineAvailable bool   `json:"engineAvailable"`
	EngineReason    string `json:"engineReason"`
}

func (s *Service) settingsOut(c *echo.Context, prefs AgentChatSettings) error {
	out := chatSettingsOut{AgentChatSettings: prefs, EngineAvailable: true}
	if err := s.engineAvailable(c.Request().Context(), prefs.UserID, nil); err != nil {
		out.EngineAvailable, out.EngineReason = false, err.Error()
	}
	return c.JSON(200, out)
}

func (s *Service) getChatSettings(c *echo.Context) error {
	uid := user(c)
	if uid == "" {
		return echo.NewHTTPError(401, "Sign in to use chat")
	}
	prefs, err := chatSettings(s.db, uid)
	if err != nil {
		return err
	}
	return s.settingsOut(c, prefs)
}

// patchChatSettings changes any of the four settings; omitted ones stay.
func (s *Service) patchChatSettings(c *echo.Context) error {
	uid := user(c)
	if uid == "" {
		return echo.NewHTTPError(401, "Sign in to use chat")
	}
	var in struct {
		Engine              *string `json:"engine"`
		ChatPermission      *string `json:"chatPermission"`
		BotPermission       *string `json:"botPermission"`
		FullAccessAllowedOn *string `json:"fullAccessAllowedOn"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid settings")
	}
	if in.Engine != nil && *in.Engine != engineClassic && *in.Engine != engineAgent {
		return echo.NewHTTPError(400, "Engine must be classic or agent")
	}
	for _, mode := range []*string{in.ChatPermission, in.BotPermission} {
		if mode == nil {
			continue
		}
		parsed, err := agent.ParseMode(*mode)
		if err != nil {
			return echo.NewHTTPError(400, "Permission must be supervised, auto or full")
		}
		*mode = string(parsed)
	}
	if in.FullAccessAllowedOn != nil && *in.FullAccessAllowedOn != allowedOnDesktop && *in.FullAccessAllowedOn != allowedOnDevices {
		return echo.NewHTTPError(400, "Full Access is allowed on desktop or devices")
	}
	var prefs AgentChatSettings
	err := s.db.Transaction(func(tx *gorm.DB) error {
		fresh := defaultChatSettings(uid)
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&fresh).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", uid).First(&prefs).Error; err != nil {
			return err
		}
		if in.Engine != nil {
			prefs.Engine = *in.Engine
		}
		if in.ChatPermission != nil {
			prefs.ChatPermission = *in.ChatPermission
		}
		if in.BotPermission != nil {
			prefs.BotPermission = *in.BotPermission
		}
		if in.FullAccessAllowedOn != nil {
			prefs.FullAccessAllowedOn = *in.FullAccessAllowedOn
		}
		return tx.Save(&prefs).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Account not found")
	}
	if err != nil {
		return err
	}
	return s.settingsOut(c, prefs)
}

// AgentToolSpecs is what the agent engine's worker registers as Timely tools
// (hello.timely_tools, plan 5.2): every Read tool classic offers, then
// propose_changes and resolve_target, and the version that changes whenever
// any of them does.
func AgentToolSpecs(catalog agent.Catalog) (string, []agent.ToolSpec) {
	specs := agent.ChatReadSpecs(catalog)
	specs = append(specs, agent.ToolSpec{Name: "propose_changes", Description: proposeDescription, Parameters: proposeParameters()})
	if fn, ok := targetSpec().(map[string]any)["function"].(map[string]any); ok {
		description, _ := fn["description"].(string)
		specs = append(specs, agent.ToolSpec{Name: targetTool, Description: description, Parameters: fn["parameters"]})
	}
	return agent.SpecsVersion(specs), specs
}

// toolSpecs answers GET /agent/tool-specs: exactly what the worker gets.
func (s *Service) toolSpecs(c *echo.Context) error {
	if user(c) == "" {
		return echo.NewHTTPError(401, "Sign in to use chat")
	}
	version, tools := AgentToolSpecs(s.factory(s.db))
	return c.JSON(200, map[string]any{"catalogVersion": version, "tools": tools})
}
