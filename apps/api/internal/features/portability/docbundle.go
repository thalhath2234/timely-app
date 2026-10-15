package portability

import (
	"archive/zip"
	"bytes"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"timely-api/internal/features/docfile"
	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

// docFileSrc matches the src of an image uploaded to Timely: "/files/<id>",
// or the same path behind the server's address.
var docFileSrc = regexp.MustCompile(`^(?:https?://[^/?#]+)?/files/(fil_[0-9a-f]{32})$`)

var imageExtensions = map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}

// DocumentMarkdownBundle exports a doc as Markdown with the images it shows.
// A doc without uploaded images is the plain .md DocumentExport gives;
// otherwise a .zip holds "<Title>.md" and an images/ folder the Markdown
// links into, so the pictures still show outside Timely. Only the user's own
// files are packed; any other image keeps its address.
func (s *Service) DocumentMarkdownBundle(userID, documentID string) ([]byte, string, string, error) {
	var document models.Document
	if err := s.db.Where("id = ? AND user_id = ?", documentID, userID).First(&document).Error; err != nil {
		return nil, "", "", err
	}
	refs := docImageRefs(document.Content)
	var files []docfile.File
	if len(refs) > 0 {
		ids := make([]string, len(refs))
		for i, ref := range refs {
			ids[i] = ref.id
		}
		if err := s.db.Where("user_id = ? AND id IN ?", userID, ids).Find(&files).Error; err != nil {
			return nil, "", "", err
		}
	}
	return markdownBundle(document, files)
}

type imageRef struct{ id, alt string }

// docImageRefs lists the uploaded files a doc's images show, once each, in
// the order they appear.
func docImageRefs(content models.JSONMap) []imageRef {
	var refs []imageRef
	seen := map[string]bool{}
	mapImages(map[string]any(content), func(attrs map[string]any) {
		src, _ := attrs["src"].(string)
		match := docFileSrc.FindStringSubmatch(src)
		if match == nil || seen[match[1]] {
			return
		}
		seen[match[1]] = true
		alt, _ := attrs["alt"].(string)
		refs = append(refs, imageRef{id: match[1], alt: alt})
	})
	return refs
}

// markdownBundle packs a doc and those of its images found in files (the
// ones the user owns) as a .zip, or returns plain Markdown when none are.
func markdownBundle(document models.Document, files []docfile.File) ([]byte, string, string, error) {
	base := safeFilename(document.Title)
	byID := make(map[string]docfile.File, len(files))
	for _, file := range files {
		byID[file.ID] = file
	}
	names := map[string]string{}
	used := map[string]bool{}
	for _, ref := range docImageRefs(document.Content) {
		if file, ok := byID[ref.id]; ok {
			names[ref.id] = bundleImageName(ref.alt, file, used)
		}
	}
	if len(names) == 0 {
		return []byte(documentMarkdown(document) + "\n"), base + ".md", "text/markdown; charset=utf-8", nil
	}
	rewritten := document
	rewritten.Content = mapImages(map[string]any(document.Content), func(attrs map[string]any) {
		src, _ := attrs["src"].(string)
		if match := docFileSrc.FindStringSubmatch(src); match != nil && names[match[1]] != "" {
			attrs["src"] = "images/" + names[match[1]]
		}
	}).(map[string]any)

	var out bytes.Buffer
	archive := zip.NewWriter(&out)
	now := time.Now()
	write := func(name string, method uint16, data []byte) error {
		w, err := archive.CreateHeader(&zip.FileHeader{Name: name, Method: method, Modified: now})
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	if err := write(base+".md", zip.Deflate, []byte(documentMarkdown(rewritten)+"\n")); err != nil {
		return nil, "", "", err
	}
	ids := make([]string, 0, len(names))
	for id := range names {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return names[ids[i]] < names[ids[j]] })
	for _, id := range ids {
		// Images are compressed already; storing them saves the work.
		if err := write("images/"+names[id], zip.Store, byID[id].Data); err != nil {
			return nil, "", "", err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, "", "", err
	}
	return out.Bytes(), base + ".zip", "application/zip", nil
}

func documentMarkdown(document models.Document) string {
	markdown := richtext.ToMarkdown(document.Content)
	if markdown == "" {
		markdown = document.PlainText
	}
	return markdown
}

// bundleImageName names an image file after its alt text, else its upload
// name, with the extension its type calls for and a number when the name is
// taken.
func bundleImageName(alt string, file docfile.File, used map[string]bool) string {
	stem := fileSlug(alt)
	if stem == "" {
		stem = fileSlug(strings.TrimSuffix(file.Name, path.Ext(file.Name)))
	}
	if stem == "" {
		stem = "image"
	}
	ext := imageExtensions[file.Mime]
	if ext == "" {
		if slug := fileSlug(strings.TrimPrefix(path.Ext(file.Name), ".")); slug != "" {
			ext = "." + strings.ToLower(slug)
		}
	}
	name := stem + ext
	for n := 2; used[strings.ToLower(name)]; n++ {
		name = fmt.Sprintf("%s-%d%s", stem, n, ext)
	}
	used[strings.ToLower(name)] = true
	return name
}

// fileSlug keeps letters, digits, "-" and "_", joining words with "-", so
// the name needs no escaping in a Markdown link or a file system.
func fileSlug(value string) string {
	var out strings.Builder
	dash := false
	count := 0
	for _, r := range value {
		if count >= 60 {
			break
		}
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_':
			if dash && out.Len() > 0 {
				out.WriteRune('-')
				count++
			}
			dash = false
			out.WriteRune(r)
			count++
		default:
			dash = true
		}
	}
	return out.String()
}

// mapImages returns a copy of a TipTap node tree, calling fn with the copied
// attrs of each image node so it can read or change them. Keys are walked in
// order so images are met in the order they appear.
func mapImages(node any, fn func(attrs map[string]any)) any {
	switch n := node.(type) {
	case map[string]any:
		keys := make([]string, 0, len(n))
		for key := range n {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(n))
		for _, key := range keys {
			out[key] = mapImages(n[key], fn)
		}
		if out["type"] == "image" {
			if attrs, ok := out["attrs"].(map[string]any); ok {
				fn(attrs)
			}
		}
		return out
	case models.JSONMap:
		return mapImages(map[string]any(n), fn)
	case []any:
		out := make([]any, len(n))
		for i, child := range n {
			out[i] = mapImages(child, fn)
		}
		return out
	default:
		return node
	}
}
