package provider

import (
	"context"
	"log"
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
// chat already uses. A rejected TypeSafe key is skipped until replaced (or
// until Settings → Test finds TypeSafe takes it again), and so is one that
// cannot be decrypted; Keys says which, so screens can tell the person.
func (s *Service) DecisionKeys(ctx context.Context, userID string) (decide.Keys, error) {
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return decide.Keys{}, err
	}
	keys := decide.Keys{Enabled: !row.DecisionsOff}
	if !keys.Enabled {
		return keys, nil
	}
	switch plain, state := s.typeSafeKey(ctx, userID); {
	case state == keyUnreadable:
		keys.TypeSafeUnreadable = true
	case state == keySaved && row.TypeSafeRejected:
		keys.TypeSafeRefused = true
	case state == keySaved:
		keys.TypeSafe = plain
	}
	keys.OpenRouter, _ = s.openRouterKey(row)
	return keys, nil
}

type savedKey int

const (
	keyNone savedKey = iota
	keySaved
	keyUnreadable // stored, but it cannot be decrypted (the server key changed)
)

// typeSafeKey is the account's saved TypeSafe key, decrypted.
func (s *Service) typeSafeKey(ctx context.Context, userID string) (string, savedKey) {
	api, ok, err := s.apiRow(s.db.WithContext(ctx), userID, TypeSafe)
	if err != nil || !ok || api.Key == "" {
		return "", keyNone
	}
	plain, err := s.decrypt(api.Key)
	if err != nil || plain == "" {
		return "", keyUnreadable
	}
	return plain, keySaved
}

// MarkTypeSafeRejected records that TypeSafe refused the account's key, the
// key a call used. A refusal that arrives after the person saved a new key
// is about the old one, so the new key is left alone. It runs inside the
// settings row's lock, which saving a key also takes, so the two cannot
// cross.
func (s *Service) MarkTypeSafeRejected(userID, key string) {
	_, _ = s.update(userID, func(row *Settings) error {
		if current, state := s.typeSafeKey(context.Background(), userID); state == keySaved && current == key {
			row.TypeSafeRejected = true
		}
		return nil
	})
}

// clearTypeSafeRejected forgets a refusal once TypeSafe took key again,
// unless the key changed meanwhile.
func (s *Service) clearTypeSafeRejected(userID, key string) {
	_, _ = s.update(userID, func(row *Settings) error {
		if current, state := s.typeSafeKey(context.Background(), userID); state == keySaved && current == key {
			row.TypeSafeRejected = false
		}
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
		// Unreadable: a key is saved but cannot be decrypted (the server's
		// encryption key changed), so it must be entered again.
		Unreadable bool `json:"unreadable"`
	} `json:"typesafe"`
	OpenRouterKeySet bool `json:"openrouterKeySet"`
	// DeepWorkTime is kept while suggestions are off. Goals live on Today
	// (features/focus) and are no longer part of these settings.
	DeepWorkTime string `json:"deepWorkTime"`
}

// keyUsable reports whether Jev has a key to run on: a TypeSafe key it has
// not refused and can read, or the OpenRouter key.
func (v decisionsView) keyUsable() bool {
	return v.typeSafeUsable() || v.OpenRouterKeySet
}

func (v decisionsView) typeSafeUsable() bool {
	return v.TypeSafe.KeySet && !v.TypeSafe.Rejected && !v.TypeSafe.Unreadable
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
	if out.TypeSafe.KeySet {
		_, state := s.typeSafeKey(ctx, userID)
		out.TypeSafe.Unreadable = state == keyUnreadable
		out.TypeSafe.Rejected = !out.TypeSafe.Unreadable && row.TypeSafeRejected
	}
	out.OpenRouterKeySet = row.OpenRouterKey != ""
	out.DeepWorkTime = row.DeepWorkTime
	if out.Enabled {
		switch {
		case out.typeSafeUsable():
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
	// Suggestions run on Jev, so they turn on only with a key it can use.
	if in.Enabled != nil && *in.Enabled {
		v, err := s.decisionsView(c.Request().Context(), user(c))
		if err != nil {
			return err
		}
		if !v.keyUsable() {
			return echo.NewHTTPError(409, noKeyMessage(v, " to turn on smart suggestions"))
		}
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
		done, ok := s.oneCheck(user(c))
		if !ok {
			return echo.NewHTTPError(429, "A key check is already running. Wait for it to finish.")
		}
		defer done()
		ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
		defer cancel()
		if err := decide.Check(ctx, s.decisionCheck, decide.Keys{TypeSafe: key}); err != nil {
			// The raw error (it can name the endpoint) stays in the log.
			log.Printf("provider: TypeSafe key check failed: %v", err)
			return echo.NewHTTPError(409, decide.KeyCheckReason(err))
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
// in the same order, and says which provider answered or why none did. A
// TypeSafe key TypeSafe refused earlier is asked again: if it is taken now,
// suggestions use it again.
func (s *Service) testDecisions(c *echo.Context) error {
	uid := user(c)
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()
	keys, err := s.DecisionKeys(ctx, uid)
	if err != nil {
		return err
	}
	retry := ""
	if keys.Enabled && keys.TypeSafeRefused {
		if plain, state := s.typeSafeKey(ctx, uid); state == keySaved {
			keys.TypeSafe, retry = plain, plain
		}
	}
	if !keys.Usable() {
		msg := "Smart suggestions are off."
		if keys.Enabled {
			v, err := s.decisionsView(ctx, uid)
			if err != nil {
				return err
			}
			msg = noKeyMessage(v, "") + "."
		}
		return c.JSON(200, decisionsTest{Error: msg})
	}
	if s.decisionCheck == nil {
		return c.JSON(200, decisionsTest{Error: "Smart suggestions are not set up on this server."})
	}
	done, ok := s.oneCheck(uid)
	if !ok {
		return c.JSON(200, decisionsTest{Error: "A test is already running."})
	}
	defer done()
	started := time.Now()
	provider, err := decide.CheckWith(context.WithValue(ctx, decide.UserKey, uid), s.decisionCheck, keys)
	out := decisionsTest{Provider: provider, LatencyMS: time.Since(started).Milliseconds()}
	if err != nil {
		log.Printf("provider: smart suggestions test failed: %v", err)
		out.Error = decide.SettingsReason(err)
	} else {
		out.OK = true
		if retry != "" && provider == decide.ProviderTypeSafe {
			s.clearTypeSafeRejected(uid, retry)
		}
	}
	return c.JSON(200, out)
}

// noKeyMessage says what is missing when no key Jev can use is saved: a
// refused or unreadable TypeSafe key is named rather than called missing.
// goal, when given, ends the sentence (" to turn on smart suggestions").
func noKeyMessage(v decisionsView, goal string) string {
	var fix string
	switch {
	case v.TypeSafe.Unreadable:
		fix = "Timely can't read your saved TypeSafe key. Enter it again, or add an OpenRouter key"
	case v.TypeSafe.Rejected:
		fix = "TypeSafe refused your saved key. Replace it, or add an OpenRouter key"
	default:
		return "Add a TypeSafe or OpenRouter key" + goal
	}
	if goal != "" {
		return fix + "," + goal
	}
	return fix
}

// oneCheck lets an account run one key check or Test at a time, so repeated
// clicks or saves do not each make a call. done ends the check.
func (s *Service) oneCheck(userID string) (done func(), ok bool) {
	if _, busy := s.checking.LoadOrStore(userID, true); busy {
		return nil, false
	}
	return func() { s.checking.Delete(userID) }, true
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
