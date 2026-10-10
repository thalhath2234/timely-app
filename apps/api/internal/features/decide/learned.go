package decide

import (
	"strings"
	"time"
)

// Learned defaults [96]. When the person keeps few of a feature's
// suggestions, that feature asks Jev for more certainty before it pre-fills,
// routes or flags anything: every reader's minimum confidence goes up. Only
// suggestions the person answered count (the screen reported kept or
// changed), from the last 30 days the log keeps.

const (
	learnWindow  = 20 // most recent answered suggestions per feature
	learnMin     = 8  // answered suggestions needed before anything changes
	learnFor     = 10 * time.Minute
	maxNeed      = 0.95 // a raised minimum never asks for more than this
	raiseSome    = 0.15 // kept under 40%
	raiseMore    = 0.3  // kept under 20%
	keptSomeRate = 0.4
	keptFewRate  = 0.2
)

// unlearned features never raise: a screen tip's only feedback is a
// dismissal (most tips have no button), so a raise would switch tips off
// with no way to earn them back. Dismissed tips are already never shown.
var unlearned = map[string]bool{"screen_tip": true}

type learnedRaise struct {
	raise float64
	until time.Time
}

// Learned is one feature's history: how many answered suggestions the
// person kept, and the extra confidence it now asks for.
type Learned struct {
	Feature string  `json:"feature"`
	Kept    int     `json:"kept"`
	Decided int     `json:"decided"`
	Raise   float64 `json:"raise"`
}

func raiseOf(feature string, kept, decided int) float64 {
	if decided < learnMin || unlearned[feature] {
		return 0
	}
	rate := float64(kept) / float64(decided)
	switch {
	case rate < keptFewRate:
		return raiseMore
	case rate < keptSomeRate:
		return raiseSome
	}
	return 0
}

func (s *Service) raiseFor(userID, feature string) float64 {
	if s == nil || s.db == nil || feature == "" {
		return 0
	}
	key := userID + "\x00" + feature
	s.mu.Lock()
	if l, ok := s.learned[key]; ok && time.Now().Before(l.until) {
		s.mu.Unlock()
		return l.raise
	}
	gen := s.learnGen
	s.mu.Unlock()
	kept, decided := s.history(userID, feature)
	raise := raiseOf(feature, kept, decided)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.learnGen != gen {
		// Feedback or a Reset landed while history was read: the counts
		// may be stale, so they are used once but not kept.
		return raise
	}
	if len(s.learned) > 5000 {
		s.learned = map[string]learnedRaise{}
	}
	s.learned[key] = learnedRaise{raise: raise, until: time.Now().Add(learnFor)}
	return raise
}

// history counts the feature's most recent answered suggestions.
func (s *Service) history(userID, feature string) (kept, decided int) {
	var rows []bool
	s.db.Model(&DecisionLog{}).Where("user_id = ? AND feature = ? AND accepted IS NOT NULL", userID, feature).
		Order("decided_at DESC").Limit(learnWindow).Pluck("accepted", &rows)
	for _, k := range rows {
		decided++
		if k {
			kept++
		}
	}
	return kept, decided
}

// forget drops an account's cached raises after new feedback. Callers run
// it after the log is written, and the generation stops a read that began
// before the write from caching the old counts.
func (s *Service) forget(userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.learnGen++
	for k := range s.learned {
		if strings.HasPrefix(k, userID+"\x00") {
			delete(s.learned, k)
		}
	}
}

// LearnedFor lists every feature the person answered suggestions for.
func (s *Service) LearnedFor(userID string) ([]Learned, error) {
	if s == nil || s.db == nil {
		return []Learned{}, nil
	}
	var features []string
	if err := s.db.Model(&DecisionLog{}).Where("user_id = ? AND accepted IS NOT NULL AND feature <> ?", userID, "test").
		Distinct("feature").Order("feature").Pluck("feature", &features).Error; err != nil {
		return nil, err
	}
	out := make([]Learned, 0, len(features))
	for _, f := range features {
		kept, decided := s.history(userID, f)
		out = append(out, Learned{Feature: f, Kept: kept, Decided: decided, Raise: raiseOf(f, kept, decided)})
	}
	return out, nil
}

// ResetLearned forgets the person's answers for one feature, so it asks
// with the usual certainty again.
func (s *Service) ResetLearned(userID, feature string) error {
	if s == nil || s.db == nil {
		return nil
	}
	err := s.db.Model(&DecisionLog{}).Where("user_id = ? AND feature = ?", userID, feature).
		Updates(map[string]any{"accepted": nil, "decided_at": nil}).Error
	s.forget(userID)
	return err
}
