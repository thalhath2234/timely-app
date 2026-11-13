// Package agentmcp is the account's external MCP servers (phase 5, decision 14;
// owner answer Q-5.6): the store (agent_mcp_servers), the three modes (Can use,
// Ask me first, Off), URL validation, OAuth sign-in through Timely's own origin,
// the encrypted tokens (agent_secrets), the catalog and a tool probe, both from
// the account's worker (timely_agent.mcp_admin), and the chat.MCPRules the
// gate asks about each tool.
//
// Accounts never mix: every row and every secret is the signed-in account's,
// another account's server answers not-found, and a worker is only ever asked
// about its own account's servers.
package agentmcp

import (
	"encoding/json"
	"time"
)

// Modes a person gives a server (agent_mcp_servers.mode).
const (
	ModeUse = "use" // Can use: runs without a card, unless the call is on the critical list
	ModeAsk = "ask" // Ask me first: a card for every call; the default for a new server
	ModeOff = "off" // Off: not connected, no tool offered
)

// Sources of a row.
const (
	SourceCatalog = "catalog" // from Hermes' curated catalog
	SourceCustom  = "custom"  // a URL or a command the person typed
)

// Kinds of agent_secrets rows this package keeps.
const (
	secretToken = "mcp-token" // name: the server; value: the token JSON the worker keeps
	secretEnv   = "mcp-env"   // name: "<server>/<VAR>"; value: one value a ${VAR} in the entry stands for
)

// Server is a row of agent_mcp_servers. Its Entry is Hermes' mcp_servers
// block for the server, with every secret as a ${VAR} reference.
type Server struct {
	ID           string          `gorm:"column:id;primaryKey;default:gen_random_uuid()"`
	UserID       string          `gorm:"column:user_id;not null"`
	Name         string          `gorm:"column:name;not null"`
	Source       string          `gorm:"column:source;not null;default:custom"`
	CatalogID    string          `gorm:"column:catalog_id;not null;default:''"`
	Entry        json.RawMessage `gorm:"column:entry;type:jsonb;serializer:json;not null;default:'{}'"`
	Mode         string          `gorm:"column:mode;not null;default:ask"`
	ApprovedHash string          `gorm:"column:approved_hash;not null;default:''"`
	LastError    string          `gorm:"column:last_error;not null;default:''"`
	CreatedAt    time.Time       `gorm:"column:created_at"`
	UpdatedAt    time.Time       `gorm:"column:updated_at"`
}

func (Server) TableName() string { return "agent_mcp_servers" }

// Secret is a row of agent_secrets: Ciphertext is the secretbox seal
// (AES-256-GCM, the provider keys' scheme) of one value.
type Secret struct {
	ID         string    `gorm:"column:id;primaryKey;default:gen_random_uuid()"`
	UserID     string    `gorm:"column:user_id;not null"`
	Kind       string    `gorm:"column:kind;not null"`
	Name       string    `gorm:"column:name;not null"`
	Ciphertext []byte    `gorm:"column:ciphertext;not null"`
	UpdatedAt  time.Time `gorm:"column:updated_at"`
}

func (Secret) TableName() string { return "agent_secrets" }
