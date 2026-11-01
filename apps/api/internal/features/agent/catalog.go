package agent

// Catalog exposes the very same handlers as Hermes without a loopback HTTP call
// or a second set of domain mutations. Authentication comes from the caller's
// verified session, never from model arguments.
import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/jsonschema-go/jsonschema"
	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Tool struct {
	Name        string                                                      `json:"name"`
	Description string                                                      `json:"description"`
	Parameters  *jsonschema.Schema                                          `json:"parameters"`
	Authority   Authority                                                   `json:"-"`
	Call        func(context.Context, string, json.RawMessage) (any, error) `json:"-"`
	// Prepare, when set, does the slow part of a write that needs no
	// transaction, such as an AI call, and returns a context that carries its
	// result for Call. The chat agent runs it before an apply's transaction
	// opens, so no lock is held while the AI answers; Call works without it.
	Prepare func(context.Context, string, json.RawMessage) (context.Context, error) `json:"-"`
	// check refuses arguments that do not match Parameters, as Call does.
	check func(json.RawMessage) error
}
type Catalog map[string]Tool

func NewCatalog(deps Deps) Catalog {
	s := &Server{Deps: deps, catalog: Catalog{}, actor: "Timely AI"}
	s.register(nil)
	return s.catalog
}

// registerTool is the one declaration of a tool: its schema and handler for
// both MCP and the in-app catalog, and its authority for the chat agent.
func registerTool[I, O any](s *Server, server *mcp.Server, tool *mcp.Tool, authority Authority, handler func(context.Context, *mcp.CallToolRequest, I) (*mcp.CallToolResult, O, error)) {
	authority.validate(tool.Name)
	tool.Annotations = authority.annotations()
	if server != nil {
		mcp.AddTool(server, tool, handler)
	}
	if s.catalog == nil {
		return
	}
	schema, err := jsonschema.For[I](nil)
	if err != nil {
		panic(err)
	}
	// Existing tool structs mark deprecated inputs with jsonschema:"-", but
	// inference treats it as literal text. Exclude those inputs from chat.
	for name, property := range schema.Properties {
		if property.Description == "-" {
			delete(schema.Properties, name)
		}
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		panic(err)
	}
	description := tool.Description
	if tool.Name == "create_task" {
		description = "Create Work in an explicitly named or unambiguous attached workspace. Omit duration unless the user gives one; Timely sets an estimated length (30 minutes without one), so do not state a length the user did not give. kind=reminder requires scheduleAt. Never infer an Inbox capture. Descriptions accept markdown."
	}
	check := func(raw json.RawMessage) error {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
		if err := resolved.Validate(value); err != nil {
			return fmt.Errorf("invalid %s arguments: %w", tool.Name, err)
		}
		return nil
	}
	s.catalog[tool.Name] = Tool{Name: tool.Name, Description: description, Parameters: schema, Authority: authority, check: check,
		Call: func(ctx context.Context, uid string, raw json.RawMessage) (any, error) {
			if uid == "" {
				return nil, fmt.Errorf("not authenticated")
			}
			if err := check(raw); err != nil {
				return nil, err
			}
			var input I
			if err := json.Unmarshal(raw, &input); err != nil {
				return nil, err
			}
			req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: uid}}}
			result, data, err := handler(ctx, req, input)
			if err != nil {
				return nil, err
			}
			if result != nil && result.IsError {
				return nil, fmt.Errorf("%s failed", tool.Name)
			}
			return objectContent(data), nil
		}}
}

// prepare gives a registered catalog tool its Prepare step. Arguments Call
// would refuse are refused the same way first, so nothing slow runs for them.
func (s *Server) prepare(name string, fn func(context.Context, string, json.RawMessage) (context.Context, error)) {
	if t, ok := s.catalog[name]; ok {
		check := t.check
		t.Prepare = func(ctx context.Context, uid string, raw json.RawMessage) (context.Context, error) {
			if uid == "" {
				return nil, fmt.Errorf("not authenticated")
			}
			if err := check(raw); err != nil {
				return nil, err
			}
			return fn(ctx, uid, raw)
		}
		s.catalog[name] = t
	}
}
