package chat

import (
	"encoding/json"
	"slices"
	"strings"
	"time"
)

type ContextChip struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Value string `json:"value"`
}

// Message kinds: "" is a normal turn, "notice" is a run event (stopped, done,
// data changed), "archive" carries a superseded or discarded plan,
// "similar" points at an earlier chat (Chat) about the same request and
// "steer" is what the person typed into a live agent run (POST /steer).
type Message struct {
	Kind      string        `json:"kind,omitempty"`
	RequestID string        `json:"requestId,omitempty"`
	Receipt   *ReceiptDraft `json:"receipt,omitempty"`
	ID        string        `json:"id"`
	Role      string        `json:"role"`
	Content   string        `json:"content"`
	CreatedAt time.Time     `json:"createdAt"`
	Steps     []Step        `json:"steps,omitempty"`
	ImageIDs  []string      `json:"imageIds,omitempty"`
	// Proposal marks a proposal summary. Remaining is what a batched proposal
	// leaves for the next batch; Timely continues automatically once the batch
	// is applied, and Continue carries that remainder on the notice it adds.
	Proposal bool `json:"proposal,omitempty"`
	// Cut marks a reply Stop cut short (its streamed text, kept, Q-2.5). It
	// does not end the turn: Retry and the next message still carry the
	// person's request.
	Cut bool `json:"cut,omitempty"`
	// Engine is "agent" on a turn's reply or proposal the agent engine
	// wrote; empty for classic's.
	Engine string `json:"engine,omitempty"`
	// AgentRun is the agent run that wrote a turn's reply or proposal; the
	// apps attach that run's learning events (which carry the same run id)
	// to it.
	AgentRun  string `json:"agentRun,omitempty"`
	Remaining string `json:"remaining,omitempty"`
	Continue  string `json:"continue,omitempty"`
	// Notes are a proposal's review notes from Jev (see jev.go).
	Notes []string `json:"notes,omitempty"`
	Chat  *ChatRef `json:"chat,omitempty"`
	// Choice is what the person did with a "similar" pointer: "move" or "stay".
	Choice string `json:"choice,omitempty"`
	// BotTags are the Bots (ids, at most 3) a person's message tags with
	// @name or the apps' picker. They belong to this one message: a run for
	// it only answers (bot_tags.go), and the next message without tags is a
	// normal turn.
	BotTags []string `json:"botTags,omitempty"`
	// BotAnswers are the ask_bot answers (bots.Answer) a reply was written
	// from, tagged Bots first, which the apps draw as cards under it.
	BotAnswers []json.RawMessage `json:"botAnswers,omitempty"`
	// AutoApplied marks a proposal Auto or Full Access applied without
	// asking (permission_mode.go); Undo reverses it until UndoneAt is set,
	// and UndoMessageID is the notice that undo added (undo.go).
	AutoApplied   bool       `json:"autoApplied,omitempty"`
	UndoneAt      *time.Time `json:"undoneAt,omitempty"`
	UndoMessageID string     `json:"undoMessageId,omitempty"`
	// UndoReads are the reads of what an auto-applied proposal's undo would
	// change, taken when it finished applying; Undo is refused once one of
	// them reads differently (the object changed since).
	UndoReads []Snapshot `json:"undoReads,omitempty"`
}
type Step struct {
	Tool      string          `json:"tool"`
	Summary   string          `json:"summary"`
	Arguments json.RawMessage `json:"arguments"`
	Result    json.RawMessage `json:"result,omitempty"`
	Status    string          `json:"status"`
	Error     string          `json:"error,omitempty"`
	Before    json.RawMessage `json:"before,omitempty"`
	// Undo marks a step of an undo plan, which may call the delete tools
	// an inverse needs (agent.UndoTool) besides the chat's Write tools.
	Undo bool `json:"undo,omitempty"`
	// Preview is what a proposed Bot reads right now (bots.PreviewResult, or
	// {"error": ...}), read once by the runner for the review card. It is
	// for the person only: never part of a snapshot, never sent back to the
	// model (promptSteps).
	Preview json.RawMessage `json:"preview,omitempty"`
}
type Snapshot struct {
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
	Hash      string          `json:"hash"`
}

// Provider and Model are fixed when a run is claimed, so a run finishes on the
// provider it started with even if the account's default changes meanwhile.
// ChosenProvider and ChosenModel are the model picked for this conversation in
// the chat menu; empty follows the account default.
type Conversation struct {
	Images         []ImageAttachment `gorm:"-" json:"images,omitempty"`
	Sensitive      bool              `json:"sensitive"`
	ImageReview    *ImageReview      `gorm:"serializer:json;type:jsonb" json:"imageReview,omitempty"`
	ForceReview    bool              `json:"-"`
	ID             string            `gorm:"primaryKey" json:"id"`
	UserID         string            `json:"-"`
	Title          string            `json:"title"`
	Status         string            `json:"status"`
	Phase          string            `json:"phase"`
	WebSearch      bool              `json:"webSearch"`
	Timezone       string            `json:"timezone"` // device IANA zone from the latest message
	Client         string            `json:"client"`   // "phone" or "web": the app of the latest message
	RichUI         bool              `json:"richUi"`   // the app of the latest message draws reply cards (genui.go)
	Language       string            `json:"language"` // see i18n.go; empty means English`
	Provider       string            `json:"provider"`
	Model          string            `json:"model"`
	ChosenProvider string            `json:"chosenProvider"`
	ChosenModel    string            `json:"chosenModel"`
	Context        []ContextChip     `gorm:"serializer:json;type:jsonb" json:"context"`
	Messages       []Message         `gorm:"serializer:json;type:jsonb" json:"messages"`
	Plan           []Step            `gorm:"serializer:json;type:jsonb" json:"plan"`
	Snapshots      []Snapshot        `gorm:"serializer:json;type:jsonb" json:"-"`
	Transcript     []WireMessage     `gorm:"serializer:json;type:jsonb" json:"-"`
	Revision       int               `json:"revision"`
	Unread         bool              `json:"unread"`
	Error          string            `json:"error"`
	// ErrorAction says what the person can do about Error (failure.go).
	ErrorAction string     `json:"errorAction,omitempty"`
	Lease       string     `json:"-"`
	LeaseUntil  *time.Time `json:"-"`
	// Engine is the chat's own engine choice ("" follows the account's
	// Settings → Agent → Engine, else "classic" or "agent"), RunEngine the
	// engine of the current or latest run, fixed when a lane claims it.
	Engine    string `gorm:"not null;default:''" json:"engine"`
	RunEngine string `gorm:"not null;default:''" json:"runEngine"`
	// Permission is how much the agent may change without asking:
	// "supervised", "auto" or "full" (permission_mode.go).
	Permission string `gorm:"not null;default:'supervised'" json:"permission"`
	// AgentRunID and AgentInstance name the live agent run and the worker
	// running it ("<pid>:<start unix ms>"); empty when none is live.
	AgentRunID    string `gorm:"not null;default:''" json:"-"`
	AgentInstance string `gorm:"not null;default:''" json:"-"`
	// Activity is what the live agent run is doing, for the apps.
	Activity ChatActivity `gorm:"serializer:json;type:jsonb" json:"activity"`
	// RunReads is the agent run's tool state (toolRun.save).
	RunReads RunReads `gorm:"serializer:json;type:jsonb" json:"-"`
	// TaintedSources are the outside sources this chat's runs read, only
	// ever added to; any at all holds every proposal for review.
	TaintedSources TaintSources `gorm:"serializer:json;type:jsonb" json:"-"`
	// SearchResults are the result addresses of the web searches this chat
	// made before it read outside content (a clean search): after taint
	// only these, a link the person typed and a site's front page may be
	// opened (plan 8.1, 12). A search made after taint may have been asked
	// for by an injected page, so its results never join. Only ever added
	// to, at most maxSearchResultsKept.
	SearchResults SearchResults `gorm:"serializer:json;type:jsonb;not null;default:'[]'" json:"-"`
	// NoLearning is "Don't learn from this chat" (plan 9b.2): its agent
	// runs write no memory or skills, and past-chat search never returns it.
	NoLearning bool `gorm:"not null;default:false" json:"noLearning"`
	// AgentReseed is set when a restore replaced the account's agent home:
	// its state.db holds the backup's transcript, so the next agent run
	// reseeds the session from Messages (AgentStateRestored).
	AgentReseed bool      `gorm:"not null;default:false" json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// The engines a chat run can use.
const (
	engineClassic = "classic"
	engineAgent   = "agent"
)

// ActivityLine is one line of a live agent run's activity: a tool it runs
// or a status it reports.
type ActivityLine struct {
	ID    string    `json:"id"`
	Kind  string    `json:"kind"` // "tool" or "status"
	Label string    `json:"label"`
	State string    `json:"state"` // "running", "done" or "failed"
	At    time.Time `json:"at"`
}

// ChatActivity is a live agent run's activity lines and the reply text
// streamed so far (draft), for apps that join after the stream started.
type ChatActivity struct {
	Run   string         `json:"run,omitempty"`
	Lines []ActivityLine `json:"lines,omitempty"`
	Draft string         `json:"draft,omitempty"`
}

// TaintSource is one outside source a chat's run read: a Timely read whose
// result carries third-party text (kind "timely", with its tool), or a
// source the agent's worker reported (web, browser, MCP, files...).
type TaintSource struct {
	Kind    string `json:"kind"`
	Tool    string `json:"tool,omitempty"`
	Host    string `json:"host,omitempty"`
	Session string `json:"session,omitempty"`
}

// TaintSources is stored as a JSON array, never null.
type TaintSources []TaintSource

func (t TaintSources) MarshalJSON() ([]byte, error) {
	if t == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]TaintSource(t))
}

// mergeTaint adds sources the chat has not recorded yet, keeping the order
// they were first read in. Nothing is ever removed.
func mergeTaint(row *Conversation, sources []TaintSource) {
	for _, src := range sources {
		known := false
		for _, have := range row.TaintedSources {
			if have == src {
				known = true
				break
			}
		}
		if !known {
			row.TaintedSources = append(row.TaintedSources, src)
		}
	}
}

// SearchResults is stored as a JSON array, never null.
type SearchResults []string

func (r SearchResults) MarshalJSON() ([]byte, error) {
	if r == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]string(r))
}

// maxSearchResultsKept caps a chat's kept clean-search results.
const maxSearchResultsKept = 200

// mergeSearchResults adds result addresses the chat has not kept yet, in
// order, up to maxSearchResultsKept; true when any was added.
func mergeSearchResults(row *Conversation, urls []string) bool {
	added := false
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u == "" || len(row.SearchResults) >= maxSearchResultsKept || slices.Contains(row.SearchResults, u) {
			continue
		}
		row.SearchResults = append(row.SearchResults, u)
		added = true
	}
	return added
}

func (Conversation) TableName() string { return "agent_conversations" }

// AgentSessionForget is a deleted chat whose session in the account's agent
// worker is still to be deleted (WorkerEngine.Forget).
type AgentSessionForget struct {
	UserID         string    `gorm:"primaryKey"`
	ConversationID string    `gorm:"primaryKey"`
	CreatedAt      time.Time `gorm:"not null"`
}

func (AgentSessionForget) TableName() string { return "agent_session_forgets" }

// MarshalJSON adds errorCode, a stable name for a failure the apps answer
// with their own action: "provider_not_chosen" opens Settings → Agent.
func (c Conversation) MarshalJSON() ([]byte, error) {
	type plain Conversation
	out := struct {
		plain
		ErrorCode string `json:"errorCode,omitempty"`
	}{plain: plain(c)}
	if c.Error == NotChosenMessage {
		out.ErrorCode = ErrorCodeNotChosen
	}
	return json.Marshal(out)
}
