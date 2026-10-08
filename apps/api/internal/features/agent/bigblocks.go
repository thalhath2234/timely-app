package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"timely-api/internal/models"
)

// Big data blocks (a 3D model is a few hundred KB of STL) would push a doc
// past what one tool result may hold, so the agent reads them as a one-line
// placeholder. Writing the placeholder back keeps the block as it was: the
// doc tools swap it for the stored block before saving.

const (
	// Models and maps are data the agent never edits by hand.
	keptDataMin = 2000
	// Other code is kept only when it is very long.
	keptCodeMin = 16000
)

var (
	dataLanguages = map[string]bool{"stl": true, "geojson": true, "topojson": true}
	keptRe        = regexp.MustCompile(`^\[kept ([A-Za-z0-9_-]+)#([0-9a-f]{12})\b[^\]\n]*\]$`)
	solidNameRe   = regexp.MustCompile(`(?m)^\s*solid\s+(\S+)`)
)

func blockHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])[:12]
}

func codeText(n map[string]any) string {
	var b strings.Builder
	for _, raw := range asList(n["content"]) {
		if child, ok := raw.(map[string]any); ok {
			text, _ := child["text"].(string)
			b.WriteString(text)
		}
	}
	return b.String()
}

func codeLanguage(n map[string]any) string {
	attrs, _ := n["attrs"].(map[string]any)
	lang, _ := attrs["language"].(string)
	return strings.ToLower(lang)
}

func asList(v any) []any {
	switch list := v.(type) {
	case []any:
		return list
	case []map[string]any:
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = item
		}
		return out
	}
	return nil
}

// keptSummary says what a placeholder stands for, so the agent can still
// talk about the block.
func keptSummary(lang, text string) string {
	size := fmt.Sprintf("%d KB", (len(text)+1023)/1024)
	switch lang {
	case "stl":
		parts := []string{}
		for _, m := range solidNameRe.FindAllStringSubmatch(text, 40) {
			parts = append(parts, m[1])
		}
		summary := fmt.Sprintf("3D model, %s, %d triangles", size, strings.Count(text, "facet normal"))
		if len(parts) > 0 {
			summary += ", parts: " + strings.Join(parts, " ")
		}
		return summary
	case "geojson", "topojson":
		return fmt.Sprintf("map data, %s", size)
	}
	return fmt.Sprintf("%d lines, %s", strings.Count(text, "\n")+1, size)
}

func shouldKeep(lang, text string) bool {
	if dataLanguages[lang] {
		return len(text) >= keptDataMin
	}
	return len(text) >= keptCodeMin
}

// shortenBlocks copies the content with each big code block's text replaced
// by a placeholder naming this doc and the block's hash. It reports how many
// blocks it kept.
func shortenBlocks(docID string, content models.JSONMap) (models.JSONMap, int) {
	kept := 0
	var walk func(v any) any
	walk = func(v any) any {
		n, ok := v.(map[string]any)
		if !ok {
			return v
		}
		if n["type"] == "codeBlock" {
			lang, text := codeLanguage(n), codeText(n)
			if !shouldKeep(lang, text) {
				return n
			}
			kept++
			copied := make(map[string]any, len(n))
			for k, val := range n {
				copied[k] = val
			}
			marker := fmt.Sprintf("[kept %s#%s %s]", docID, blockHash(text), keptSummary(lang, text))
			copied["content"] = []any{map[string]any{"type": "text", "text": marker}}
			return copied
		}
		children := asList(n["content"])
		if len(children) == 0 {
			return n
		}
		copied := make(map[string]any, len(n))
		for k, val := range n {
			copied[k] = val
		}
		next := make([]any, len(children))
		for i, child := range children {
			next[i] = walk(child)
		}
		copied["content"] = next
		return copied
	}
	out, _ := walk(map[string]any(content)).(map[string]any)
	return models.JSONMap(out), kept
}

// restoreBlocks swaps every placeholder in content for the block it names.
// load reads the doc a placeholder came from (usually the one being edited).
func restoreBlocks(content models.JSONMap, load func(docID string) (models.JSONMap, error)) (bool, error) {
	type ref struct {
		node      map[string]any
		doc, hash string
	}
	var refs []ref
	var walk func(v any)
	walk = func(v any) {
		n, ok := v.(map[string]any)
		if !ok {
			return
		}
		if n["type"] == "codeBlock" {
			if m := keptRe.FindStringSubmatch(strings.TrimSpace(codeText(n))); m != nil {
				refs = append(refs, ref{n, m[1], m[2]})
			}
			return
		}
		for _, child := range asList(n["content"]) {
			walk(child)
		}
	}
	walk(map[string]any(content))
	if len(refs) == 0 {
		return false, nil
	}
	blocks := map[string]map[string]string{}
	for _, r := range refs {
		byHash, ok := blocks[r.doc]
		if !ok {
			source, err := load(r.doc)
			if err != nil {
				return false, fmt.Errorf("A [kept %s#%s] placeholder names a doc that can't be read: %w", r.doc, r.hash, err)
			}
			byHash = map[string]string{}
			var collect func(v any)
			collect = func(v any) {
				n, ok := v.(map[string]any)
				if !ok {
					return
				}
				if n["type"] == "codeBlock" {
					text := codeText(n)
					byHash[blockHash(text)] = text
					return
				}
				for _, child := range asList(n["content"]) {
					collect(child)
				}
			}
			collect(map[string]any(source))
			blocks[r.doc] = byHash
		}
		text, ok := byHash[r.hash]
		if !ok {
			return false, fmt.Errorf("The block [kept %s#%s] is no longer in that doc (it changed after you read it). Call get_doc again and use the placeholder it returns now", r.doc, r.hash)
		}
		r.node["content"] = []any{map[string]any{"type": "text", "text": text}}
	}
	return true, nil
}
