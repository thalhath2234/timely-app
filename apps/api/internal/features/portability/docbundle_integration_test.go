package portability

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timely-api/internal/features/docfile"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
)

// The Markdown export packs the doc's images the user uploaded, and not an
// image of another account's that the doc happens to show.
func TestIntegrationDocMarkdownBundleOwnFilesOnly(t *testing.T) {
	db := migratedDB(t)
	const uid, other = "usr_portability_bundle", "usr_portability_bundle_other"
	owner := uid
	for _, row := range []any{
		&models.User{ID: uid, Email: "bundle@example.invalid", Password: "not-a-real-hash"},
		&models.User{ID: other, Email: "bundle-other@example.invalid", Password: "not-a-real-hash"},
		&models.Workspace{ID: "ws_bundle", Name: "Private", UserID: &owner},
		&docfile.File{ID: bundleFileA, UserID: uid, Name: "beach.png", Mime: "image/png", Size: 4, Data: []byte("mine")},
		&docfile.File{ID: bundleFileB, UserID: other, Name: "secret.png", Mime: "image/png", Size: 6, Data: []byte("theirs")},
		&models.Document{ID: "doc_bundle", Title: "Trip", UserID: uid, WorkspaceID: "ws_bundle",
			Content: docWithImages(imageNode("/files/"+bundleFileA, "Beach"), imageNode("/files/"+bundleFileB, "Secret")).Content},
		&models.Document{ID: "doc_bundle_plain", Title: "Plain", UserID: uid, WorkspaceID: "ws_bundle",
			Content: docWithImages(imageNode("/files/"+bundleFileB, "Secret")).Content},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(db, nil)

	data, filename, contentType, err := service.DocumentMarkdownBundle(uid, "doc_bundle")
	if err != nil {
		t.Fatal(err)
	}
	if filename != "Trip.zip" || contentType != "application/zip" {
		t.Fatalf("got %q %q", filename, contentType)
	}
	entries := readZip(t, data)
	if len(entries) != 2 || string(entries["images/Beach.png"]) != "mine" {
		t.Fatalf("zip = %v", entries)
	}
	if md := string(entries["Trip.md"]); !strings.Contains(md, "![Beach](images/Beach.png)") || !strings.Contains(md, "/files/"+bundleFileB) {
		t.Fatalf("markdown:\n%s", md)
	}

	data, filename, _, err = service.DocumentMarkdownBundle(uid, "doc_bundle_plain")
	if err != nil || filename != "Plain.md" || strings.Contains(string(data), "theirs") {
		t.Fatalf("doc with only foreign images: %q %q %v", filename, data, err)
	}

	if _, _, _, err := service.DocumentMarkdownBundle(other, "doc_bundle"); err == nil {
		t.Fatal("another account exported the doc")
	}

	// Over HTTP the default stays Markdown text; images=zip asks for the zip.
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", uid)
			return next(c)
		}
	})
	e.GET("/docs/:id/export", NewHandler(service).ExportDocument)
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}
	if rec := get("/docs/doc_bundle/export?format=markdown"); rec.Code != http.StatusOK ||
		!strings.HasPrefix(rec.Header().Get("Content-Type"), "text/markdown") || !strings.Contains(rec.Body.String(), "/files/"+bundleFileA) {
		t.Fatalf("default export %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	rec := get("/docs/doc_bundle/export?format=markdown&images=zip")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/zip" ||
		!strings.Contains(rec.Header().Get("Content-Disposition"), `filename="Trip.zip"`) {
		t.Fatalf("zip export %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Header().Get("Content-Disposition"))
	}
	if entries := readZip(t, rec.Body.Bytes()); string(entries["images/Beach.png"]) != "mine" {
		t.Fatalf("zip over HTTP = %v", entries)
	}
}
