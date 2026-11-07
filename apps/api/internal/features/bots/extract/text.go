package extract

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/andybalholm/cascadia"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"timely-api/internal/utils"
)

// MaxSelector caps a CSS selector's length.
const MaxSelector = 500

// hidden elements never show as text. chrome elements are the site's
// furniture around the content; Text drops them, a selector may pick them.
var (
	hidden = map[atom.Atom]bool{
		atom.Head: true, atom.Script: true, atom.Style: true, atom.Noscript: true,
		atom.Template: true, atom.Svg: true, atom.Iframe: true, atom.Object: true,
	}
	chrome = map[atom.Atom]bool{
		atom.Nav: true, atom.Header: true, atom.Footer: true, atom.Aside: true, atom.Form: true,
	}
	// block elements start a new line, so words in neighbouring blocks never run together.
	block = map[atom.Atom]bool{
		atom.Address: true, atom.Article: true, atom.Blockquote: true, atom.Body: true,
		atom.Br: true, atom.Dd: true, atom.Details: true, atom.Div: true, atom.Dl: true,
		atom.Dt: true, atom.Figcaption: true, atom.Figure: true, atom.H1: true, atom.H2: true,
		atom.H3: true, atom.H4: true, atom.H5: true, atom.H6: true, atom.Hr: true, atom.Li: true,
		atom.Main: true, atom.Ol: true, atom.P: true, atom.Pre: true, atom.Section: true,
		atom.Summary: true, atom.Table: true, atom.Td: true, atom.Th: true, atom.Tr: true,
		atom.Ul: true, atom.Caption: true, atom.Option: true,
	}
)

// Text returns the readable text of an HTML page: one line per block, with
// scripts, styles and the site's navigation, header, footer, sidebars and
// forms left out, clipped at MaxText.
func Text(body []byte, contentType string) (string, error) {
	doc, err := parseHTML(body, contentType)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	writeText(&b, doc, true)
	return finish(b.String())
}

// ValidSelector reports whether css is a selector Select can use.
func ValidSelector(css string) error {
	_, err := compile(css)
	return err
}

func compile(css string) ([][]step, error) {
	css = strings.TrimSpace(css)
	switch {
	case css == "":
		return nil, errors.New("the CSS selector is empty")
	case len(css) > MaxSelector:
		return nil, fmt.Errorf("the CSS selector is longer than %d characters", MaxSelector)
	}
	if _, err := cascadia.Compile(css); err != nil {
		return nil, fmt.Errorf("the CSS selector is not valid: %w", err)
	}
	return plan(css)
}

// Select returns the text of every element css matches, one per line. An
// element inside an earlier match is not read twice. No match, or matches
// with no text, gives ErrEmpty; running out of time gives ErrTooComplex.
func Select(body []byte, contentType, css string) (string, error) {
	chains, err := compile(css)
	if err != nil {
		return "", err
	}
	doc, err := parseHTML(body, contentType)
	if err != nil {
		return "", err
	}
	b := newBudget()
	matches, err := matchAll(doc, chains, b)
	if err != nil {
		return "", err
	}
	matched := make(map[*html.Node]bool, len(matches))
	for _, n := range matches {
		matched[n] = true
	}
	var sb strings.Builder
	inside := 0
	err = walk(doc, b, func(n *html.Node) {
		if !matched[n] {
			return
		}
		if inside == 0 {
			sb.WriteByte('\n')
			writeChildren(&sb, n, false)
			sb.WriteByte('\n')
		}
		inside++
	}, func(n *html.Node) {
		if matched[n] {
			inside--
		}
	})
	if err != nil {
		return "", err
	}
	return finish(sb.String())
}

func writeText(b *strings.Builder, n *html.Node, dropChrome bool) {
	switch n.Type {
	case html.TextNode:
		// A line break in the source is only space; blocks make the lines.
		b.WriteString(strings.ReplaceAll(n.Data, "\n", " "))
		return
	case html.ElementNode:
		if hidden[n.DataAtom] || (dropChrome && chrome[n.DataAtom]) {
			return
		}
		if block[n.DataAtom] {
			b.WriteByte('\n')
			defer b.WriteByte('\n')
		}
	case html.DocumentNode:
	default:
		return
	}
	writeChildren(b, n, dropChrome)
}

func writeChildren(b *strings.Builder, n *html.Node, dropChrome bool) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		writeText(b, c, dropChrome)
	}
}

// finish collapses the space in each line, drops empty lines and clips.
func finish(s string) (string, error) {
	lines := strings.Split(s, "\n")
	out := lines[:0]
	for _, l := range lines {
		if l = strings.Join(strings.Fields(l), " "); l != "" {
			out = append(out, l)
		}
	}
	if len(out) == 0 {
		return "", ErrEmpty
	}
	return utils.StorableText(strings.Join(out, "\n"), MaxText), nil
}

// The parts of a page that change on every visit without the page changing.
var (
	agoRe = regexp.MustCompile(`(?i)\b(?:\d+|an?|one|a few)\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|[smhdwy])\s+ago\b|\bjust now\b`)
	// "Updated", then any date and time words after it.
	updatedRe = regexp.MustCompile(`(?i)\b(?:last\s+)?updated(?:\s+(?:on|at))?\s*:?(?:[\s,.:/-]*` + dateWord + `\b\.?)*`)
	clockRe   = regexp.MustCompile(`(?i)\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\b\.?)?`)
)

const dateWord = `(?:\d{1,4}(?:st|nd|rd|th)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|today|yesterday|at|[ap]\.?m|utc|gmt|ist|est|edt|cst|cdt|pst|pdt|cet|cest|bst|jst|aest)`

// Normalize collapses space and strips what changes on every visit:
// "5 minutes ago", "Updated …" and clock times, so only real changes move
// Hash.
func Normalize(s string) string {
	s = agoRe.ReplaceAllString(s, " ")
	s = updatedRe.ReplaceAllString(s, " ")
	s = clockRe.ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(s), " ")
}

// Hash is the hex SHA-256 of Normalize(s).
func Hash(s string) string {
	sum := sha256.Sum256([]byte(Normalize(s)))
	return hex.EncodeToString(sum[:])
}
