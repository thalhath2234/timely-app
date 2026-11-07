package bots

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/features/bots/price"
	"timely-api/internal/secretbox"
)

// keyLabel separates sealed price source keys from every other secretbox
// value, such as the agent's provider keys.
const keyLabel = "timely-bot-source:"

// Key states, as stored in bot_source_keys.state.
const (
	KeyOK      = "ok"
	KeyRefused = "refused" // the source turned it down, or it no longer opens
)

// keyCheckWait bounds the test read a save makes.
const keyCheckWait = 30 * time.Second

// KeyTestsPerHour caps one person's key saves: each makes a live read of
// the source, whose slots every account's checks share.
const KeyTestsPerHour = 10

// ErrKeyLimit is a person saving keys faster than KeyTestsPerHour.
var ErrKeyLimit = errors.New("Too many key checks right now. Try again later.")

var keyTests = newPreviewLimiter(KeyTestsPerHour, time.Hour)

// sourceKeyShape is what every keyed source's keys look like today.
var sourceKeyShape = regexp.MustCompile(`^[A-Za-z0-9]{8,64}$`)

// ErrUnknownSource means the source is not in the registry or needs no key.
var ErrUnknownSource = errors.New("unknown price source")

// SourceDownError means a key could not be tested because the source did
// not answer. Message is for the person.
type SourceDownError struct{ Message string }

func (e *SourceDownError) Error() string { return e.Message }

// SourceKey is one saved price source key (table bot_source_keys). APIKey is
// sealed and never leaves the server.
type SourceKey struct {
	UserID    string    `gorm:"type:text;primaryKey"`
	Source    string    `gorm:"type:text;primaryKey"`
	APIKey    string    `gorm:"column:api_key;type:text;not null"`
	KeyHint   string    `gorm:"type:text;not null"`
	State     string    `gorm:"type:text;not null"`
	CheckedAt time.Time `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (SourceKey) TableName() string { return "bot_source_keys" }

// SourceKeyView is one keyed source as Settings shows it: whether a key is
// saved and its last four characters, never the key.
type SourceKeyView struct {
	Source    string     `json:"source"`
	Label     string     `json:"label"`
	KeySet    bool       `json:"keySet"`
	KeyHint   string     `json:"keyHint"`
	State     string     `json:"state"` // ok, refused, or "" with no key
	CheckedAt *time.Time `json:"checkedAt"`
}

// KeyStore opens the price source keys people save. It is the price.Keys
// the checks use.
type KeyStore struct {
	db  *gorm.DB
	box *secretbox.Box
}

// NewKeyStore needs TIMELY_BACKUP_KEY or JWT_SECRET (secretbox.New).
func NewKeyStore(db *gorm.DB) (*KeyStore, error) {
	box, err := secretbox.New(keyLabel)
	if err != nil {
		return nil, err
	}
	return &KeyStore{db: db, box: box}, nil
}

// SourceKey answers the person's key for source, or "" when none is saved.
// A key the source refused, or one that no longer opens (the server's
// secret changed), is *price.KeyError{Rejected: true}: the check is then a
// needs_key strike, not a job error that retries every minute.
func (k *KeyStore) SourceKey(ctx context.Context, userID, source string) (string, error) {
	return k.sourceKey(ctx, userID, source, true)
}

// lookOnlyKeys is a KeyStore that never marks a key refused, for reads
// that save nothing (a preview).
type lookOnlyKeys struct{ k *KeyStore }

func (l lookOnlyKeys) SourceKey(ctx context.Context, userID, source string) (string, error) {
	return l.k.sourceKey(ctx, userID, source, false)
}

// sourceKey is SourceKey; mark false leaves a key that no longer opens as
// it is, still refused for this read.
func (k *KeyStore) sourceKey(ctx context.Context, userID, source string, mark bool) (string, error) {
	var rows []SourceKey
	if err := k.db.WithContext(ctx).Where("user_id = ? AND source = ?", userID, source).Limit(1).Find(&rows).Error; err != nil {
		return "", err
	}
	if len(rows) == 0 {
		return "", nil
	}
	if rows[0].State != KeyOK {
		return "", &price.KeyError{Source: source, Rejected: true}
	}
	key, err := k.box.Open(rows[0].APIKey)
	if err != nil || strings.TrimSpace(key) == "" {
		if !mark {
			return "", &price.KeyError{Source: source, Rejected: true}
		}
		if err := k.db.WithContext(ctx).Model(&SourceKey{}).Where("user_id = ? AND source = ? AND state = ?", userID, source, KeyOK).
			Updates(map[string]any{"state": KeyRefused, "updated_at": time.Now().UTC()}).Error; err != nil {
			log.Printf("bots: mark an unreadable %s key: %v", source, err)
		}
		return "", &price.KeyError{Source: source, Rejected: true}
	}
	return key, nil
}

// oneKey is the Keys a save tests its candidate with.
type oneKey string

func (k oneKey) SourceKey(context.Context, string, string) (string, error) { return string(k), nil }

// keyedSource finds a registry source that takes a key.
func keyedSource(name string) (price.Source, bool) {
	src, ok := price.Sources[strings.ToLower(strings.TrimSpace(name))]
	return src, ok && src.KeyHeader != ""
}

// keySet loads the sources the person has a working key for.
func keySet(db *gorm.DB, userID string) (hasKeyFunc, error) {
	var sources []string
	if err := db.Model(&SourceKey{}).Where("user_id = ? AND state = ?", userID, KeyOK).Pluck("source", &sources).Error; err != nil {
		return nil, err
	}
	set := make(map[string]bool, len(sources))
	for _, s := range sources {
		set[s] = true
	}
	return func(source string) bool { return set[source] }, nil
}

// needsKeyLine refuses a watch on a keyed source the person has no key for.
func needsKeyLine(src price.Source) string {
	return sentence(src.Kind) + " prices need your free " + src.Label + " key. Add it in Settings › Agent"
}

// SourceKeys lists every keyed source, with or without a saved key.
func (s *Service) SourceKeys(ctx context.Context, userID string) ([]SourceKeyView, error) {
	var rows []SourceKey
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		return nil, err
	}
	saved := make(map[string]SourceKey, len(rows))
	for _, r := range rows {
		saved[r.Source] = r
	}
	out := []SourceKeyView{}
	for _, name := range price.Names() {
		src := price.Sources[name]
		if src.KeyHeader == "" {
			continue
		}
		out = append(out, keyView(src, saved[name]))
	}
	return out, nil
}

func keyView(src price.Source, r SourceKey) SourceKeyView {
	v := SourceKeyView{Source: src.Name, Label: src.Label}
	if r.Source != "" {
		at := r.CheckedAt.UTC()
		v.KeySet, v.KeyHint, v.State, v.CheckedAt = true, r.KeyHint, r.State, &at
	}
	return v
}

// SaveSourceKey tests key with one read of the source's probe symbol and
// saves it sealed. A key the source turns down is an *InputError; a source
// that does not answer is *SourceDownError. Nothing is saved either way.
func (s *Service) SaveSourceKey(ctx context.Context, userID, source, key string) (SourceKeyView, error) {
	src, ok := keyedSource(source)
	if !ok {
		return SourceKeyView{}, ErrUnknownSource
	}
	if s.keyStore == nil {
		return SourceKeyView{}, errors.New("bots: price source keys are not set up")
	}
	key = strings.TrimSpace(key)
	if !sourceKeyShape.MatchString(key) {
		return SourceKeyView{}, invalid("That doesn't look like a %s key", src.Label)
	}
	if !keyTests.take(userID, 1, s.now().UTC()) {
		return SourceKeyView{}, ErrKeyLimit
	}
	readCtx, cancel := context.WithTimeout(ctx, keyCheckWait)
	_, err := price.Get(readCtx, s.fetch, oneKey(key), price.Query{UserID: userID, Source: src.Name, Symbol: src.Probe}, s.now().UTC())
	cancel()
	var keyErr *price.KeyError
	switch {
	case errors.As(err, &keyErr) && keyErr.Rejected, errors.Is(err, fetch.ErrForbidden):
		return SourceKeyView{}, invalid("%s did not accept this key", src.Label)
	case err != nil:
		return SourceKeyView{}, &SourceDownError{Message: "Could not reach " + src.Label + ". Try again in a minute."}
	}
	sealed, err := s.keyStore.box.Seal(key)
	if err != nil {
		return SourceKeyView{}, err
	}
	now := s.now().UTC()
	row := SourceKey{UserID: userID, Source: src.Name, APIKey: sealed, KeyHint: secretbox.Hint(key), State: KeyOK, CheckedAt: now, CreatedAt: now, UpdatedAt: now}
	err = s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "source"}},
		DoUpdates: clause.AssignmentColumns([]string{"api_key", "key_hint", "state", "checked_at", "updated_at"}),
	}).Create(&row).Error
	if err != nil {
		return SourceKeyView{}, err
	}
	return keyView(src, row), nil
}

// DeleteSourceKey forgets the person's key. Their watches stay on the
// source, and each check without a key is a needs_key strike.
func (s *Service) DeleteSourceKey(ctx context.Context, userID, source string) error {
	src, ok := keyedSource(source)
	if !ok {
		return ErrUnknownSource
	}
	return s.db.WithContext(ctx).Where("user_id = ? AND source = ?", userID, src.Name).Delete(&SourceKey{}).Error
}

// markKeyRefused records, in a check's transaction, that the source turned
// down a key saved before the check started. A key saved since is a new one
// and keeps its state.
func markKeyRefused(tx *gorm.DB, userID, source string, started, now time.Time) error {
	return tx.Model(&SourceKey{}).Where("user_id = ? AND source = ? AND state = ? AND updated_at <= ?", userID, source, KeyOK, started).
		Updates(map[string]any{"state": KeyRefused, "checked_at": now, "updated_at": now}).Error
}

func (s *Service) sourceKeys(c *echo.Context) error {
	keys, err := s.SourceKeys(c.Request().Context(), user(c))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"keys": keys})
}

// saveSourceKey takes {"key": "..."}.
func (s *Service) saveSourceKey(c *echo.Context) error {
	var in struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(c.Request().Body).Decode(&in); err != nil {
		return badRequest()
	}
	v, err := s.SaveSourceKey(c.Request().Context(), user(c), c.Param("source"), in.Key)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, v)
}

func (s *Service) deleteSourceKey(c *echo.Context) error {
	if err := s.DeleteSourceKey(c.Request().Context(), user(c), c.Param("source")); err != nil {
		return httpError(err)
	}
	return c.NoContent(http.StatusNoContent)
}
