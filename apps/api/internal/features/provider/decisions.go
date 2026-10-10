package provider

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
)

// TypeSafe is the agent_api_keys provider id of the account's TypeSafe key
// for smart suggestions (Jev). It is not a chat provider: apiViews only lists
// registry providers, so it never appears in the model picker.
const TypeSafe = "typesafe"

// SetDecisions connects the suggestion service, used to check new keys and
// record feedback.
func (s *Service) SetDecisions(d *decide.Service, check decide.Caller) {
	s.decisions, s.decisionCheck = d, check
}

// DecisionKeys is decide's KeySource: TypeSafe first, then the OpenRouter key
// chat already uses. A rejected TypeSafe key is skipped until replaced.
func (s *Service) DecisionKeys(ctx context.Context, userID string) (decide.Keys, error) {
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return decide.Keys{}, err
	}
	keys := decide.Keys{Enabled: !row.DecisionsOff}
	if !keys.Enabled {
		return keys, nil
	}
	if !row.TypeSafeRejected {
		if api, ok, err := s.apiRow(s.db.WithContext(ctx), userID, TypeSafe); err == nil && ok {
			keys.TypeSafe, _ = s.decrypt(api.Key)
		}
	}
	keys.OpenRouter, _ = s.openRouterKey(row)
	return keys, nil
}

// MarkTypeSafeRejected records that TypeSafe refused the account's key.
func (s *Service) MarkTypeSafeRejected(userID string) {
	_, _ = s.update(userID, func(row *Settings) error {
		row.TypeSafeRejected = true
		return nil
	})
}

type decisionsView struct {
	Enabled   bool   `json:"enabled"`
	Available bool   `json:"available"`
	Provider  string `json:"provider,omitempty"`
	TypeSafe  struct {
		KeySet   bool   `json:"keySet"`
		KeyHint  string `json:"keyHint,omitempty"`
		Rejected bool   `json:"rejected"`
	} `json:"typesafe"`
	OpenRouterKeySet bool `json:"openrouterKeySet"`
	// DeepWorkTime is kept while suggestions are off. Goals live on Today
	// (features/focus) and are no longer part of these settings.
	DeepWorkTime string `json:"deepWorkTime"`
}

// DeepWorkTimes are the times of day the person may prefer for deep work.
var DeepWorkTimes = []string{"", "morning", "afternoon", "evening"}

func (s *Service) decisionsView(ctx context.Context, userID string) (decisionsView, error) {
	var out decisionsView
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return out, err
	}
	api, ok, err := s.apiRow(s.db.WithContext(ctx), userID, TypeSafe)
	if err != nil {
		return out, err
	}
	out.Enabled = !row.DecisionsOff
	out.TypeSafe.KeySet = ok && api.Key != ""
	out.TypeSafe.KeyHint = api.KeyHint
	out.TypeSafe.Rejected = out.TypeSafe.KeySet && row.TypeSafeRejected
	out.OpenRouterKeySet = row.OpenRouterKey != ""
	out.DeepWorkTime = row.DeepWorkTime
	if out.Enabled {
		switch {
		case out.TypeSafe.KeySet && !row.TypeSafeRejected:
			out.Available, out.Provider = true, decide.ProviderTypeSafe
		case out.OpenRouterKeySet:
			out.Available, out.Provider = true, decide.ProviderOpenRouter
		}
	}
	return out, nil
}

func (s *Service) decisionsOverview(c *echo.Context) error {
	v, err := s.decisionsView(c.Request().Context(), user(c))
	if err != nil {
		return err
	}
	return c.JSON(200, v)
}

func (s *Service) configureDecisions(c *echo.Context) error {
	var in struct {
		Enabled      *bool   `json:"enabled"`
		DeepWorkTime *string `json:"deepWorkTime"`
	}
	if err := c.Bind(&in); err != nil || (in.Enabled == nil && in.DeepWorkTime == nil) {
		return echo.NewHTTPError(400, "Invalid request")
	}
	if in.DeepWorkTime != nil && !slices.Contains(DeepWorkTimes, *in.DeepWorkTime) {
		return echo.NewHTTPError(400, "Invalid time of day")
	}
	if _, err := s.update(user(c), func(row *Settings) error {
		if in.Enabled != nil {
			row.DecisionsOff = !*in.Enabled
		}
		if in.DeepWorkTime != nil {
			row.DeepWorkTime = *in.DeepWorkTime
		}
		return nil
	}); err != nil {
		return err
	}
	return s.decisionsOverview(c)
}

// setTypeSafeKey checks the key with one tiny Jev call against TypeSafe only,
// then stores it encrypted. The response never includes the key.
func (s *Service) setTypeSafeKey(c *echo.Context) error {
	var in struct {
		Key string `json:"key"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	key := strings.TrimSpace(in.Key)
	if len(key) < 8 || len(key) > 400 || strings.ContainsAny(key, " \n\t") {
		return echo.NewHTTPError(400, "That does not look like a TypeSafe API key")
	}
	if s.decisionCheck != nil {
		ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
		defer cancel()
		if err := decide.Check(ctx, s.decisionCheck, decide.Keys{TypeSafe: key}); err != nil {
			return echo.NewHTTPError(409, "TypeSafe did not accept this key: "+err.Error())
		}
	}
	sealed, err := s.encrypt(key)
	if err != nil {
		return err
	}
	row, _, err := s.apiRow(s.db, user(c), TypeSafe)
	if err != nil {
		return err
	}
	row.Key, row.KeyHint = sealed, hint(key)
	if err := s.saveAPIRow(&row); err != nil {
		return err
	}
	if _, err := s.update(user(c), func(row *Settings) error {
		row.TypeSafeRejected = false
		return nil
	}); err != nil {
		return err
	}
	return s.decisionsOverview(c)
}

func (s *Service) removeTypeSafeKey(c *echo.Context) error {
	if err := s.db.Where("user_id = ? AND provider = ?", user(c), TypeSafe).Delete(&APIKey{}).Error; err != nil {
		return err
	}
	if _, err := s.update(user(c), func(row *Settings) error {
		row.TypeSafeRejected = false
		return nil
	}); err != nil {
		return err
	}
	return s.decisionsOverview(c)
}

type decisionsTest struct {
	OK        bool   `json:"ok"`
	Provider  string `json:"provider,omitempty"`
	LatencyMS int64  `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
}

// testDecisions makes one tiny live call with the keys suggestions would use,
// in the same order, and says which provider answered or why none did.
func (s *Service) testDecisions(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()
	keys, err := s.DecisionKeys(ctx, user(c))
	if err != nil {
		return err
	}
	if !keys.Usable() {
		return c.JSON(200, decisionsTest{Error: "Smart suggestions are off or no key is saved."})
	}
	if s.decisionCheck == nil {
		return c.JSON(200, decisionsTest{Error: "Smart suggestions are not set up on this server."})
	}
	started := time.Now()
	provider, err := decide.CheckWith(context.WithValue(ctx, decide.UserKey, user(c)), s.decisionCheck, keys)
	out := decisionsTest{Provider: provider, LatencyMS: time.Since(started).Milliseconds()}
	if err != nil {
		out.Error = err.Error()
	} else {
		out.OK = true
	}
	return c.JSON(200, out)
}

// decisionFeedback records whether the person kept a suggestion, for tuning.
func (s *Service) decisionFeedback(c *echo.Context) error {
	var in struct {
		LogID    string `json:"logId"`
		Accepted bool   `json:"accepted"`
	}
	if err := c.Bind(&in); err != nil || len(in.LogID) > 80 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	if err := s.decisions.Feedback(user(c), in.LogID, in.Accepted); err != nil {
		return err
	}
	return c.NoContent(204)
}

// decisionsLearned lists how often the person kept each feature's
// suggestions and which ones now ask for more certainty [96].
func (s *Service) decisionsLearned(c *echo.Context) error {
	out, err := s.decisions.LearnedFor(user(c))
	if err != nil {
		return err
	}
	return c.JSON(200, map[string]any{"features": out})
}

// resetLearned forgets the person's answers for one feature.
func (s *Service) resetLearned(c *echo.Context) error {
	var in struct {
		Feature string `json:"feature"`
	}
	if err := c.Bind(&in); err != nil || in.Feature == "" || len(in.Feature) > 60 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	if err := s.decisions.ResetLearned(user(c), in.Feature); err != nil {
		return err
	}
	return c.NoContent(204)
}
