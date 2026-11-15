package bots

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The notepad's caps, Hermes' own (cron/notepad.py): a key is at most 128
// characters, a value 16 KB, and one Bot's keys and values together 64 KB.
// The notepad is put in front of the agent on every run, so it stays small.
const (
	MaxNoteKeyChars   = 128
	MaxNoteValueBytes = 16 * 1024
	MaxNotepadBytes   = 64 * 1024
)

// The errors a notepad write gives; each message says what to do.
var (
	ErrNoteKey     = invalid("A note's key is 1 to %d characters, with no control characters", MaxNoteKeyChars)
	ErrNoteValue   = invalid("A note's value is at most %d KB", MaxNoteValueBytes/1024)
	ErrNotepadFull = invalid("The notepad is full: a bot keeps at most %d KB in all. Delete notes it no longer needs", MaxNotepadBytes/1024)
	ErrNoNote      = errors.New("bots: no such note")
)

// NotesStore is a Bot's notepad (table bot_notes): small notes it keeps for
// itself between runs, one value per key. Every call is scoped to a person
// and a Bot, so one Bot never reads another's.
type NotesStore struct{ db *gorm.DB }

// NewNotesStore makes the notepad store on db.
func NewNotesStore(db *gorm.DB) *NotesStore { return &NotesStore{db: db} }

func (n *NotesStore) conn(ctx context.Context) *gorm.DB { return n.db.WithContext(ctx) }

// checkNoteEntry enforces the key and value caps.
func checkNoteEntry(key, value string) error {
	if key == "" || utf8.RuneCountInString(key) > MaxNoteKeyChars || !utf8.ValidString(key) || strings.IndexFunc(key, unicode.IsControl) >= 0 {
		return ErrNoteKey
	}
	if !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
		return invalid("A note's value is text")
	}
	if len(value) > MaxNoteValueBytes {
		return ErrNoteValue
	}
	return nil
}

// Get is the note at key and whether there is one.
func (n *NotesStore) Get(ctx context.Context, userID, botID, key string) (string, bool, error) {
	var row Note
	err := n.conn(ctx).Where("user_id = ? AND bot_id = ? AND key = ?", userID, botID, key).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	return row.Value, err == nil, err
}

// Set writes the note at key, replacing its value. It refuses a key or a
// value past its cap, and a write that would take the Bot's notepad past
// 64 KB (keys and values counted in bytes, the note being replaced not
// counted); nothing is changed then. The Bot must be the person's.
func (n *NotesStore) Set(ctx context.Context, userID, botID, key, value string) error {
	if err := checkNoteEntry(key, value); err != nil {
		return err
	}
	return n.conn(ctx).Transaction(func(tx *gorm.DB) error {
		// Lock the Bot's row so two writes cannot pass the total together; it
		// also proves the Bot is the person's.
		var owned int
		if err := tx.Raw("SELECT 1 FROM bots WHERE id = ? AND user_id = ? FOR UPDATE", botID, userID).Scan(&owned).Error; err != nil {
			return err
		}
		if owned != 1 {
			return gorm.ErrRecordNotFound
		}
		var others int64
		if err := tx.Raw(`SELECT COALESCE(SUM(octet_length(key) + octet_length(value)), 0) FROM bot_notes WHERE bot_id = ? AND key <> ?`, botID, key).Scan(&others).Error; err != nil {
			return err
		}
		if others+int64(len(key)+len(value)) > MaxNotepadBytes {
			return ErrNotepadFull
		}
		row := Note{BotID: botID, UserID: userID, Key: key, Value: value, UpdatedAt: time.Now().UTC()}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "bot_id"}, {Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
		}).Create(&row).Error
	})
}

// Delete removes the note at key; ErrNoNote when there is none.
func (n *NotesStore) Delete(ctx context.Context, userID, botID, key string) error {
	res := n.conn(ctx).Where("user_id = ? AND bot_id = ? AND key = ?", userID, botID, key).Delete(&Note{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNoNote
	}
	return nil
}

// List is the Bot's notes, by key.
func (n *NotesStore) List(ctx context.Context, userID, botID string) ([]Note, error) {
	var rows []Note
	err := n.conn(ctx).Where("user_id = ? AND bot_id = ?", userID, botID).Order("key").Find(&rows).Error
	return rows, err
}

// Map is the Bot's notes as the agent is given them (RunInput.Notes).
func (n *NotesStore) Map(ctx context.Context, userID, botID string) (map[string]string, error) {
	rows, err := n.List(ctx, userID, botID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(rows))
	for _, r := range rows {
		out[r.Key] = r.Value
	}
	return out, nil
}
