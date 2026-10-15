package portability

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"

	"timely-api/internal/features/docfile"
	"timely-api/internal/models"
)

const (
	bundleFileA = "fil_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	bundleFileB = "fil_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	bundleFileC = "fil_cccccccccccccccccccccccccccccccc"
)

func imageNode(src, alt string) map[string]any {
	return map[string]any{"type": "image", "attrs": map[string]any{"src": src, "alt": alt}}
}

func docWithImages(images ...map[string]any) models.Document {
	content := []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Trip notes"}}}}
	for _, image := range images {
		content = append(content, map[string]any{"type": "paragraph", "content": []any{image}})
	}
	return models.Document{Title: "Trip: Day 1", Content: models.JSONMap{"type": "doc", "content": content}}
}

func readZip(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	out := map[string][]byte{}
	for _, file := range reader.File {
		rc, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		out[file.Name], _ = io.ReadAll(rc)
		rc.Close()
	}
	return out
}

func TestMarkdownBundleWithoutImagesIsPlainMarkdown(t *testing.T) {
	doc := docWithImages(imageNode("https://example.com/cat.png", "cat"))
	data, filename, contentType, err := markdownBundle(doc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if filename != "Trip Day 1.md" || !strings.HasPrefix(contentType, "text/markdown") {
		t.Fatalf("got %q %q", filename, contentType)
	}
	if !strings.Contains(string(data), "Trip notes") || !strings.Contains(string(data), "![cat](https://example.com/cat.png)") {
		t.Fatalf("markdown = %q", data)
	}
}

func TestMarkdownBundlePacksImagesAndRewritesLinks(t *testing.T) {
	doc := docWithImages(
		imageNode("/files/"+bundleFileA, "Beach photo"),
		imageNode("http://localhost:8080/files/"+bundleFileB, "Beach photo"),
		imageNode("/files/"+bundleFileA, "again"),
		imageNode("/files/"+bundleFileC, ""),
	)
	files := []docfile.File{
		{ID: bundleFileA, Name: "IMG_1.jpeg", Mime: "image/jpeg", Data: []byte("jpeg-bytes")},
		{ID: bundleFileB, Name: "other.jpg", Mime: "image/jpeg", Data: []byte("second-jpeg")},
		{ID: bundleFileC, Name: "sketch final.webp", Mime: "image/webp", Data: []byte("webp-bytes")},
	}
	data, filename, contentType, err := markdownBundle(doc, files)
	if err != nil {
		t.Fatal(err)
	}
	if filename != "Trip Day 1.zip" || contentType != "application/zip" {
		t.Fatalf("got %q %q", filename, contentType)
	}
	entries := readZip(t, data)
	if len(entries) != 4 {
		t.Fatalf("zip holds %d entries: %v", len(entries), entries)
	}
	for name, want := range map[string]string{
		"images/Beach-photo.jpg":   "jpeg-bytes",
		"images/Beach-photo-2.jpg": "second-jpeg",
		"images/sketch-final.webp": "webp-bytes",
	} {
		if string(entries[name]) != want {
			t.Fatalf("%s = %q", name, entries[name])
		}
	}
	md := string(entries["Trip Day 1.md"])
	for _, want := range []string{"![Beach photo](images/Beach-photo.jpg)", "![Beach photo](images/Beach-photo-2.jpg)", "![again](images/Beach-photo.jpg)", "![](images/sketch-final.webp)"} {
		if !strings.Contains(md, want) {
			t.Fatalf("markdown lacks %q:\n%s", want, md)
		}
	}
	if strings.Contains(md, "/files/") {
		t.Fatalf("markdown still links to the server:\n%s", md)
	}
	// The doc itself is left as it was.
	attrs := doc.Content["content"].([]any)[1].(map[string]any)["content"].([]any)[0].(map[string]any)["attrs"].(map[string]any)
	if attrs["src"] != "/files/"+bundleFileA {
		t.Fatalf("doc was changed: %v", attrs["src"])
	}
}

// Only files passed in (the user's own) are packed; another account's image
// keeps its address.
func TestMarkdownBundleLeavesOtherFilesAlone(t *testing.T) {
	doc := docWithImages(imageNode("/files/"+bundleFileA, "mine"), imageNode("/files/"+bundleFileB, "theirs"))
	data, _, _, err := markdownBundle(doc, []docfile.File{{ID: bundleFileA, Name: "a.png", Mime: "image/png", Data: []byte("mine")}})
	if err != nil {
		t.Fatal(err)
	}
	entries := readZip(t, data)
	if len(entries) != 2 || string(entries["images/mine.png"]) != "mine" {
		t.Fatalf("zip = %v", entries)
	}
	if md := string(entries["Trip Day 1.md"]); !strings.Contains(md, "![theirs](/files/"+bundleFileB+")") {
		t.Fatalf("foreign image link changed:\n%s", md)
	}

	plain, filename, _, err := markdownBundle(docWithImages(imageNode("/files/"+bundleFileB, "theirs")), nil)
	if err != nil || filename != "Trip Day 1.md" || !strings.Contains(string(plain), "/files/"+bundleFileB) {
		t.Fatalf("doc with only foreign images: %q %q %v", filename, plain, err)
	}
}

func TestContentDispositionKeepsNonASCIITitles(t *testing.T) {
	got := contentDisposition("Café notes.zip")
	if got != `attachment; filename="Caf_ notes.zip"; filename*=UTF-8''Caf%C3%A9%20notes.zip` {
		t.Fatalf("contentDisposition = %s", got)
	}
}
