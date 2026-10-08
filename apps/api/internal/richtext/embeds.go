package richtext

import (
	"regexp"
	"strings"

	"github.com/yuin/goldmark/ast"
)

// Embeds and bookmarks are blocks that point at a web page.
//
// An embed shows a video, song or design in the doc. It is written as an
// image of the page, the way Obsidian embeds a YouTube video:
//
//	![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)
//
// so only links from the providers below become embeds when read back; any
// other image stays an image. Keep embedPatterns in step with
// packages/contract/src/embeds.ts.
//
// A bookmark is a link card with the page's title and description. It is a
// link alone on its line, the description as the link title, and a marker
// comment Markdown viewers hide:
//
//	[Page title](https://example.com "What the page says")<!-- bookmark -->
var embedPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^https?://(?:www\.|m\.|music\.)?youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/)[\w-]{11}`),
	regexp.MustCompile(`(?i)^https?://youtu\.be/[\w-]{11}`),
	regexp.MustCompile(`(?i)^https?://(?:www\.)?vimeo\.com/(?:video/)?\d+`),
	regexp.MustCompile(`(?i)^https?://(?:www\.)?loom\.com/(?:share|embed)/[0-9a-f]+`),
	regexp.MustCompile(`(?i)^https?://open\.spotify\.com/(?:intl-[a-z-]+/)?(?:track|album|playlist|episode|show|artist)/\w+`),
	regexp.MustCompile(`(?i)^https?://(?:www\.)?figma\.com/(?:file|design|proto|board)/\w+`),
	regexp.MustCompile(`(?i)^https?://codepen\.io/[\w-]+/(?:pen|full|details|embed)/\w+`),
}

const bookmarkMarker = "<!-- bookmark -->"

// IsEmbedURL reports whether src is a page Timely can embed.
func IsEmbedURL(src string) bool {
	for _, re := range embedPatterns {
		if re.MatchString(src) {
			return true
		}
	}
	return false
}

func renderEmbed(n map[string]any) string {
	src, _ := attrOf(n, "src").(string)
	if src == "" {
		return ""
	}
	return "![](" + linkDestination(src) + ")"
}

func renderBookmark(n map[string]any) string {
	href, _ := attrOf(n, "url").(string)
	if href == "" {
		return ""
	}
	title, _ := attrOf(n, "title").(string)
	description, _ := attrOf(n, "description").(string)
	text := escapeText(strings.Join(strings.Fields(title), " "))
	if text == "" {
		text = escapeText(href)
	}
	dest := linkDestination(href)
	if description = strings.Join(strings.Fields(description), " "); description != "" {
		dest += ` "` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(description) + `"`
	}
	return "[" + text + "](" + dest + ")" + bookmarkMarker
}

// linkBlock reads a paragraph that is only an embeddable image or only a
// bookmark link.
func (r reader) linkBlock(p ast.Node) map[string]any {
	first := p.FirstChild()
	if first == nil {
		return nil
	}
	switch v := first.(type) {
	case *ast.Image:
		src := string(v.Destination)
		if v.NextSibling() == nil && IsEmbedURL(src) {
			return map[string]any{"type": "embed", "attrs": map[string]any{"src": src}}
		}
	case *ast.Link:
		marker, ok := v.NextSibling().(*ast.RawHTML)
		if !ok || marker.NextSibling() != nil || strings.TrimSpace(r.rawHTML(marker)) != bookmarkMarker {
			return nil
		}
		href := string(v.Destination)
		title := plainText(r.inline(v))
		if title == href {
			title = ""
		}
		attrs := map[string]any{"url": href, "title": title, "description": unescapeMarkdown(string(v.Title))}
		return map[string]any{"type": "bookmark", "attrs": attrs}
	}
	return nil
}

// bookmarkText is what search sees of a bookmark.
func bookmarkText(n map[string]any) string {
	title, _ := attrOf(n, "title").(string)
	description, _ := attrOf(n, "description").(string)
	return strings.TrimSpace(title + " " + description)
}
