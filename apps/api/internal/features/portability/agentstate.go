package portability

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"

	"timely-api/internal/agenthost"
)

// AgentStore is where a backup's agent state comes from and goes back to
// (*agenthost.Supervisor; plan 6.5, Q-3.4). Without one, backups carry no
// agent state and a restore says it left the backup's out.
type AgentStore interface {
	ExportState(ctx context.Context, account string, dropSessions []string) (zip []byte, sha string, err error)
	StageRestore(ctx context.Context, account string, zip []byte) (agenthost.Staged, error)
	CommitRestore(ctx context.Context, staged agenthost.Staged) error
	DiscardRestore(staged agenthost.Staged) error
}

// SetAgentState gives backups the account's agent state.
func (s *Service) SetAgentState(store AgentStore) { s.agent = store }

const agentStateTimeout = 4 * time.Minute

// The words a backup or a restore shows about the agent state.
var (
	warnAgentTooLarge    = fmt.Sprintf("What Timely learned was left out of this backup because it is larger than %d MB. Everything else is in it.", agenthost.MaxStateBytes>>20)
	warnAgentUnavailable = "What Timely learned was left out of this backup because the assistant is not available on this server. Everything else is in it."
	warnAgentUnreadable  = "What Timely learned could not be read, so it was left out of this backup. Everything else is in it."
	warnAgentNotHere     = "What Timely learned was not restored because the assistant is not available on this server. Everything else was restored."
	warnAgentNotStaged   = "What Timely learned could not be restored from this backup. Everything else was restored."
	warnAgentNotFromApps = "What Timely learned is never restored by an outside app, so it was left as it is."
	warnAgentKept        = "What Timely learned was not in this backup, so it was left as it is."
)

func warnSkillsBlocked(names []string) string {
	if len(names) == 1 {
		return fmt.Sprintf("The learned skill %q was left out because it looked unsafe.", names[0])
	}
	return fmt.Sprintf("%d learned skills were left out because they looked unsafe: %s.", len(names), strings.Join(names, ", "))
}

// ExportAccount is Export with the account's agent state: the person's own
// download and the stored backups, with the agent's rows. Export alone
// (what an outside app gets from export_account) carries only the other
// rows. Above the 64 MB cap, or when
// the agent state cannot be read, the backup leaves it out and says so in
// Warnings; an account that never used the agent has none and no warning.
func (s *Service) ExportAccount(ctx context.Context, userID string) (*Backup, error) {
	backup, err := s.export(userID, true)
	if err != nil {
		return nil, err
	}
	backup.Agent, backup.Warnings = s.exportAgent(ctx, userID)
	return backup, nil
}

func (s *Service) exportAgent(ctx context.Context, userID string) (*AgentState, []string) {
	if s.agent == nil {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, agentStateTimeout)
	defer cancel()
	// A chat deleted while no worker ran still waits for its session.delete:
	// the backup leaves its transcript out (review round 6).
	var forgotten []string
	if s.db == nil {
		// no database (unit tests): nothing waits
	} else if err := s.db.Raw(`SELECT conversation_id FROM agent_session_forgets WHERE user_id = ? ORDER BY conversation_id`, userID).Scan(&forgotten).Error; err != nil {
		log.Printf("backup %s: agent state left out: %v", safeAccountDirectory(userID), err)
		return nil, []string{warnAgentUnreadable}
	}
	zip, sha, err := s.agent.ExportState(ctx, userID, forgotten)
	if err == nil && len(zip) > agenthost.MaxStateBytes {
		err = agenthost.ErrStateTooLarge
	}
	switch {
	case err == nil:
		return &AgentState{Format: agenthost.AgentStateFormat, Version: agenthost.AgentStateVersion, SHA256: sha, Zip: zip}, nil
	case errors.Is(err, agenthost.ErrNoAgentState):
		return nil, nil
	case errors.Is(err, agenthost.ErrStateTooLarge):
		log.Printf("backup %s: agent state left out: %v", safeAccountDirectory(userID), err)
		return nil, []string{warnAgentTooLarge}
	case errors.Is(err, agenthost.ErrNoRuntime):
		return nil, []string{warnAgentUnavailable}
	default:
		log.Printf("backup %s: agent state left out: %v", safeAccountDirectory(userID), err)
		return nil, []string{warnAgentUnreadable}
	}
}

// validateAgentState refuses a backup whose agent state is not what an
// export wrote; the account is not changed.
func validateAgentState(state *AgentState) error {
	if state.Format != agenthost.AgentStateFormat || state.Version != agenthost.AgentStateVersion {
		return fmt.Errorf("This backup's assistant data has an unknown format (%q version %d), so your account was not changed.", state.Format, state.Version)
	}
	if len(state.Zip) == 0 || len(state.Zip) > agenthost.MaxStateBytes {
		return errors.New("This backup's assistant data is empty or too large, so your account was not changed.")
	}
	if subtle.ConstantTimeCompare([]byte(strings.ToLower(state.SHA256)), []byte(checksum(state.Zip))) != 1 {
		return errors.New("This backup's assistant data is damaged (its checksum does not match), so your account was not changed.")
	}
	return nil
}

// stageAgent stages the backup's agent state beside the account's home.
// When the assistant is not available here, or the state cannot be staged,
// the rows still restore and the warning says what was left out.
func (s *Service) stageAgent(userID string, state *AgentState) (*agenthost.Staged, []string) {
	if s.agent == nil {
		return nil, []string{warnAgentNotHere}
	}
	ctx, cancel := context.WithTimeout(context.Background(), agentStateTimeout)
	defer cancel()
	staged, err := s.agent.StageRestore(ctx, userID, state.Zip)
	if errors.Is(err, agenthost.ErrNoRuntime) {
		return nil, []string{warnAgentNotHere}
	}
	if err != nil {
		log.Printf("restore %s: stage agent state: %v", safeAccountDirectory(userID), err)
		return nil, []string{warnAgentNotStaged}
	}
	var warnings []string
	if len(staged.Blocked) > 0 {
		warnings = append(warnings, warnSkillsBlocked(staged.Blocked))
	}
	if len(staged.Dropped) > 0 {
		log.Printf("restore %s: agent state: left out %d path(s): %s", safeAccountDirectory(userID), len(staged.Dropped), strings.Join(staged.Dropped, "; "))
	}
	return &staged, warnings
}

// forgetGoneChats queues session.delete for each chat the staged state.db
// holds that the account no longer has (deleted after the backup was
// made): restore never brings chats back, so nothing else would delete it,
// and it would ride along in every later backup (review round 6). The
// worker sends them at the account's next run, as for any deleted chat.
func forgetGoneChats(tx *gorm.DB, userID string, sessions []string) error {
	for _, cid := range sessions {
		if cid == "" {
			continue
		}
		err := tx.Exec(`INSERT INTO agent_session_forgets (user_id, conversation_id, created_at)
			SELECT ?, ?, now() WHERE NOT EXISTS (SELECT 1 FROM agent_conversations WHERE id = ? AND user_id = ?)
			ON CONFLICT DO NOTHING`, userID, cid, cid, userID).Error
		if err != nil {
			return fmt.Errorf("restore: forget deleted chats: %w", err)
		}
	}
	return nil
}

// commitAgent swaps the staged agent state in once the rows committed. A
// failure leaves the account's agent home as it was (CommitRestore cleans
// up) and says so.
func (s *Service) commitAgent(staged agenthost.Staged) []string {
	ctx, cancel := context.WithTimeout(context.Background(), agentStateTimeout)
	defer cancel()
	if err := s.agent.CommitRestore(ctx, staged); err != nil {
		log.Printf("restore %s: swap in agent state: %v", safeAccountDirectory(staged.Account), err)
		return []string{warnAgentNotStaged}
	}
	return nil
}
