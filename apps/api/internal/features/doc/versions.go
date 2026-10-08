package doc

import (
	"errors"
	"time"
	"timely-api/internal/models"

	"github.com/google/uuid"
)

const (
	// An edit after this long without one saves the doc as it was first.
	versionQuietSpell = 10 * time.Minute
	maxVersionsPerDoc = 100
	// A long editing session still gets a version this often.
	versionMaxGap = time.Hour
)

// Why a version was saved; the history shows it next to the time.
const (
	VersionEdit      = "edit"
	VersionAssistant = "assistant"
	VersionRestore   = "restore"
)

// Version is one saved state of a doc. Content is left out of lists.
type Version struct {
	ID         string          `gorm:"primaryKey" json:"id"`
	DocumentID string          `json:"documentId"`
	UserID     string          `json:"-"`
	Title      string          `json:"title"`
	Content    *models.JSONMap `gorm:"type:jsonb" json:"content,omitempty"`
	PlainText  string          `json:"plainText,omitempty"`
	Words      int             `gorm:"-" json:"words"`
	Reason     string          `json:"reason"`
	EditedAt   time.Time       `json:"editedAt"`
	CreatedAt  time.Time       `json:"createdAt"`
}

func (Version) TableName() string { return "doc_versions" }

// saveVersion stores doc as it is now, unless an edit version was saved
// moments ago (force skips that check). Old versions beyond the cap go.
func (s *documentService) saveVersion(doc *models.Document, reason string, force bool) error {
	if doc == nil || models.IsDocumentContentEmpty(doc.Content) {
		return nil
	}
	edited, err := time.Parse(time.RFC3339, doc.UpdatedAt)
	if err != nil {
		edited = time.Now().UTC()
	}
	if !force {
		latest, err := s.repo.LatestVersionAt(doc.ID)
		if err != nil {
			return err
		}
		// Save when editing starts again after a pause, and every hour
		// during a long session; keystrokes in between share one version.
		newSession := time.Since(edited) >= versionQuietSpell && time.Since(latest) >= versionQuietSpell
		if !latest.IsZero() && !newSession && time.Since(latest) < versionMaxGap {
			return nil
		}
	}
	content := doc.Content
	version := &Version{
		ID: "ver_" + uuid.NewString(), DocumentID: doc.ID, UserID: doc.UserID, Title: doc.Title,
		Content: &content, PlainText: doc.PlainText, Reason: reason, EditedAt: edited.UTC(), CreatedAt: time.Now().UTC(),
	}
	if err := s.repo.CreateVersion(version); err != nil {
		return err
	}
	return s.repo.PruneVersions(doc.ID, maxVersionsPerDoc)
}

func (s *documentService) Versions(userID, documentID string) ([]Version, error) {
	if _, err := s.GetByID(userID, documentID); err != nil {
		return nil, err
	}
	versions, err := s.repo.ListVersions(userID, documentID)
	if err != nil {
		return nil, err
	}
	for i := range versions {
		versions[i].Words = countWords(versions[i].PlainText)
		versions[i].PlainText = ""
	}
	return versions, nil
}

func (s *documentService) GetVersion(userID, documentID, versionID string) (*Version, error) {
	version, err := s.repo.GetVersion(userID, documentID, versionID)
	if err != nil {
		return nil, err
	}
	version.Words = countWords(version.PlainText)
	return version, nil
}

// RestoreVersion puts a saved version back, saving the current state first
// so the restore itself can be undone from the history.
func (s *documentService) RestoreVersion(userID, documentID, versionID string) (*models.Document, error) {
	version, err := s.repo.GetVersion(userID, documentID, versionID)
	if err != nil {
		return nil, err
	}
	if version.Content == nil {
		return nil, errors.New("this version has no content")
	}
	current, err := s.GetByID(userID, documentID)
	if err != nil {
		return nil, err
	}
	if err := s.saveVersion(current, VersionRestore, true); err != nil {
		return nil, err
	}
	title, plain := version.Title, version.PlainText
	return s.Update(userID, documentID, DocumentUpdate{Title: &title, Content: version.Content, PlainText: &plain, skipVersion: true})
}

func countWords(text string) int {
	words, inWord := 0, false
	for _, r := range text {
		space := r == ' ' || r == '\n' || r == '\t' || r == '\r' || r == ' '
		if space {
			inWord = false
		} else if !inWord {
			inWord = true
			words++
		}
	}
	return words
}
