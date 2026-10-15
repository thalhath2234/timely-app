package doc

import (
	"errors"
	"time"
	"timely-api/internal/models"

	"github.com/google/uuid"
)

const (
	// An edit after this long without one starts a new version.
	versionQuietSpell = 10 * time.Minute
	maxVersionsPerDoc = 100
	// A long editing session still starts a new version this often.
	versionMaxGap = time.Hour
)

// Why a version was saved; the history shows it next to the time.
// VersionAssistant and VersionRestore are older rows that hold the doc as it
// was just before such a change; newer rows hold the doc as it was after it.
const (
	VersionEdit      = "edit"
	VersionAssistant = "assistant"
	VersionRestore   = "restore"
	// The doc as the assistant left it.
	VersionAssistantChange = "assistant_change"
	// The doc after an older version was put back.
	VersionRestored = "restored"
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
	// Current marks the version that holds the doc as it is now.
	Current bool `gorm:"-" json:"current,omitempty"`
}

func (Version) TableName() string { return "doc_versions" }

// The history keeps one version per editing session, and the newest one
// follows the doc as it is saved, so the history always ends with the doc as
// it is now. Before, a version was only saved when editing started again after
// a pause, which left the last session's work out of the history.

// sameContent reports whether a version holds this content.
func sameContent(version *Version, content models.JSONMap) bool {
	if version == nil || version.Content == nil {
		return false
	}
	a, errA := models.MarshalJSONMap(*version.Content)
	b, errB := models.MarshalJSONMap(content)
	return errA == nil && errB == nil && string(a) == string(b)
}

func editedAt(doc *models.Document) time.Time {
	if edited, err := time.Parse(time.RFC3339, doc.UpdatedAt); err == nil {
		return edited.UTC()
	}
	return time.Now().UTC()
}

func (s *documentService) createVersion(doc *models.Document, reason string, edited time.Time) error {
	if doc == nil || models.IsDocumentContentEmpty(doc.Content) {
		return nil
	}
	content := doc.Content
	version := &Version{
		ID: "ver_" + uuid.NewString(), DocumentID: doc.ID, UserID: doc.UserID, Title: doc.Title,
		Content: &content, PlainText: doc.PlainText, Reason: reason, EditedAt: edited, CreatedAt: time.Now().UTC(),
	}
	if err := s.repo.CreateVersion(version); err != nil {
		return err
	}
	return s.repo.PruneVersions(doc.ID, maxVersionsPerDoc)
}

// recordVersion puts the doc as just saved (`after`) into the history.
// `before` is the doc as it was before the change and `latest` the newest
// version at that moment: a session's edits keep updating the version that
// holds `before`, and a version of `before` is kept first when the history
// does not have it yet (a doc older than the history, or an edit that skipped
// it).
func (s *documentService) recordVersion(before *models.Document, latest *Version, after *models.Document, reason string) error {
	if after == nil {
		return nil
	}
	tracks := before != nil && sameContent(latest, before.Content)
	now := time.Now().UTC()
	if reason == VersionEdit && tracks && latest.Reason == VersionEdit &&
		now.Sub(latest.EditedAt) < versionQuietSpell && now.Sub(latest.CreatedAt) < versionMaxGap {
		if models.IsDocumentContentEmpty(after.Content) {
			return nil
		}
		return s.repo.UpdateVersion(latest.ID, after.Title, after.Content, after.PlainText, now)
	}
	if !tracks && before != nil {
		if err := s.createVersion(before, VersionEdit, editedAt(before)); err != nil {
			return err
		}
	}
	return s.createVersion(after, reason, now)
}

func (s *documentService) Versions(userID, documentID string) ([]Version, error) {
	doc, err := s.GetByID(userID, documentID)
	if err != nil {
		return nil, err
	}
	versions, err := s.repo.ListVersions(userID, documentID)
	if err != nil {
		return nil, err
	}
	if len(versions) > 0 {
		if latest, err := s.repo.LatestVersion(documentID); err == nil && latest != nil && latest.ID == versions[0].ID {
			versions[0].Current = sameContent(latest, doc.Content)
		}
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

// RestoreVersion puts a saved version back. The doc as it was stays in the
// history, so the restore itself can be undone from there.
func (s *documentService) RestoreVersion(userID, documentID, versionID string) (*models.Document, error) {
	version, err := s.repo.GetVersion(userID, documentID, versionID)
	if err != nil {
		return nil, err
	}
	if version.Content == nil {
		return nil, errors.New("this version has no content")
	}
	title, plain := version.Title, version.PlainText
	return s.Update(userID, documentID, DocumentUpdate{Title: &title, Content: version.Content, PlainText: &plain, versionReason: VersionRestored})
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
