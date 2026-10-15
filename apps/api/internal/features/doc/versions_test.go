package doc

import (
	"testing"
	"time"

	"timely-api/internal/models"
)

// versionRepo keeps versions in memory; the history only needs these calls.
type versionRepo struct {
	DocumentRepository
	versions []*Version
}

func (r *versionRepo) CreateVersion(version *Version) error {
	r.versions = append([]*Version{version}, r.versions...)
	return nil
}

func (r *versionRepo) PruneVersions(string, int) error { return nil }

func (r *versionRepo) UpdateVersion(id, title string, content models.JSONMap, plainText string, editedAt time.Time) error {
	for _, v := range r.versions {
		if v.ID == id {
			v.Title, v.Content, v.PlainText, v.EditedAt = title, &content, plainText, editedAt
		}
	}
	return nil
}

func (r *versionRepo) latest() *Version {
	if len(r.versions) == 0 {
		return nil
	}
	return r.versions[0]
}

func textDoc(text string, updated time.Time) *models.Document {
	return &models.Document{
		ID: "doc_1", UserID: "usr_1", Title: "Plan", PlainText: text, UpdatedAt: updated.UTC().Format(time.RFC3339),
		Content: models.JSONMap{"type": "doc", "content": []any{
			map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}},
		}},
	}
}

func textOf(v *Version) string {
	return (*v.Content)["content"].([]any)[0].(map[string]any)["content"].([]any)[0].(map[string]any)["text"].(string)
}

// Saves during one session keep one version up to date with the doc, so the
// history always ends with what the doc holds now.
func TestRecordVersionFollowsTheSession(t *testing.T) {
	repo := &versionRepo{}
	s := &documentService{repo: repo}
	now := time.Now()

	// A brand-new doc: nothing to keep from before, the first text is saved.
	if err := s.recordVersion(textDoc("", now), repo.latest(), textDoc("a", now), VersionEdit); err != nil {
		t.Fatal(err)
	}
	if len(repo.versions) != 1 || textOf(repo.versions[0]) != "a" {
		t.Fatalf("after the first save: %d versions", len(repo.versions))
	}
	for _, text := range []string{"ab", "abc"} {
		before := textDoc(textOf(repo.latest()), now)
		if err := s.recordVersion(before, repo.latest(), textDoc(text, now), VersionEdit); err != nil {
			t.Fatal(err)
		}
	}
	if len(repo.versions) != 1 || textOf(repo.versions[0]) != "abc" {
		t.Fatalf("one session should keep one version with the latest text, got %d (%q)", len(repo.versions), textOf(repo.versions[0]))
	}

	// After a pause, editing starts a new version and the old one stays.
	repo.versions[0].EditedAt = now.Add(-versionQuietSpell - time.Minute)
	if err := s.recordVersion(textDoc("abc", now), repo.latest(), textDoc("abcd", now), VersionEdit); err != nil {
		t.Fatal(err)
	}
	if len(repo.versions) != 2 || textOf(repo.versions[0]) != "abcd" || textOf(repo.versions[1]) != "abc" {
		t.Fatalf("after a pause: %d versions", len(repo.versions))
	}

	// A long session starts a new version every hour too.
	repo.versions[0].CreatedAt = now.Add(-versionMaxGap - time.Minute)
	if err := s.recordVersion(textDoc("abcd", now), repo.latest(), textDoc("abcde", now), VersionEdit); err != nil {
		t.Fatal(err)
	}
	if len(repo.versions) != 3 {
		t.Fatalf("after an hour: %d versions", len(repo.versions))
	}
}

// A doc whose current text is not in the history yet (older than the history,
// or changed without it) keeps that text as a version before the new one.
func TestRecordVersionKeepsTheStateBefore(t *testing.T) {
	repo := &versionRepo{}
	s := &documentService{repo: repo}
	earlier := time.Now().Add(-48 * time.Hour)

	if err := s.recordVersion(textDoc("old text", earlier), nil, textDoc("new text", time.Now()), VersionEdit); err != nil {
		t.Fatal(err)
	}
	if len(repo.versions) != 2 || textOf(repo.versions[0]) != "new text" || textOf(repo.versions[1]) != "old text" {
		t.Fatalf("got %d versions", len(repo.versions))
	}
	if !repo.versions[1].EditedAt.Equal(earlier.UTC().Truncate(time.Second)) {
		t.Fatalf("the kept version is dated %v, want when it was last edited", repo.versions[1].EditedAt)
	}
}

// An assistant change is a version of its own and is never folded into the
// session's version, so it can be undone from the history.
func TestRecordVersionAssistantChangeStandsAlone(t *testing.T) {
	repo := &versionRepo{}
	s := &documentService{repo: repo}
	now := time.Now()

	_ = s.recordVersion(textDoc("", now), nil, textDoc("mine", now), VersionEdit)
	if err := s.recordVersion(textDoc("mine", now), repo.latest(), textDoc("assistant", now), VersionAssistantChange); err != nil {
		t.Fatal(err)
	}
	if err := s.recordVersion(textDoc("assistant", now), repo.latest(), textDoc("assistant + me", now), VersionEdit); err != nil {
		t.Fatal(err)
	}
	reasons := []string{}
	for _, v := range repo.versions {
		reasons = append(reasons, v.Reason+":"+textOf(v))
	}
	want := []string{"edit:assistant + me", "assistant_change:assistant", "edit:mine"}
	if len(reasons) != len(want) {
		t.Fatalf("versions %v, want %v", reasons, want)
	}
	for i := range want {
		if reasons[i] != want[i] {
			t.Fatalf("versions %v, want %v", reasons, want)
		}
	}
}
