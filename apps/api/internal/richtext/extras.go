package richtext

import (
	"bytes"
	"regexp"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// goldmark parsers for the Markdown extras GitHub and Obsidian read beyond
// GFM: $math$ and $$ blocks, [^footnotes], [[wiki links]]. Callouts and
// frontmatter need no parser; frommarkdown.go recognises them from the
// blockquote and the file head. packages/contract/src/markdown.ts reads the
// same syntax for the web and mobile importers.

// --- $$ math block -------------------------------------------------------

var kindMathBlock = ast.NewNodeKind("MathBlock")

type mathBlockNode struct {
	ast.BaseBlock
	// closed is set when the opening line also held the closing $$.
	closed bool
}

func (n *mathBlockNode) Kind() ast.NodeKind { return kindMathBlock }

func (n *mathBlockNode) IsRaw() bool { return true }

func (n *mathBlockNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type mathBlockParser struct{}

func (*mathBlockParser) Trigger() []byte { return []byte{'$'} }

func (*mathBlockParser) Open(parent ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, segment := reader.PeekLine()
	pos := pc.BlockOffset()
	if pos < 0 || !bytes.HasPrefix(line[pos:], []byte("$$")) {
		return nil, parser.NoChildren
	}
	node := &mathBlockNode{}
	rest := bytes.TrimSpace(line[pos+2:])
	// $$ x $$ on one line is a complete block.
	if len(rest) >= 2 && bytes.HasSuffix(rest, []byte("$$")) {
		inner := bytes.TrimSpace(rest[:len(rest)-2])
		start := segment.Start + pos + 2 + bytes.Index(line[pos+2:], inner)
		if len(inner) > 0 {
			node.Lines().Append(text.NewSegment(start, start+len(inner)))
		}
		node.closed = true
		reader.AdvanceToEOL()
		return node, parser.NoChildren
	}
	if len(rest) > 0 {
		// Text after the opening $$ is the first line of the formula.
		start := segment.Start + pos + 2 + bytes.Index(line[pos+2:], rest)
		seg := text.NewSegment(start, segment.Stop)
		seg.ForceNewline = true
		node.Lines().Append(seg)
	}
	reader.AdvanceToEOL()
	return node, parser.NoChildren
}

func (*mathBlockParser) Continue(node ast.Node, reader text.Reader, pc parser.Context) parser.State {
	if node.(*mathBlockNode).closed {
		return parser.Close
	}
	line, segment := reader.PeekLine()
	if bytes.Equal(bytes.TrimSpace(line), []byte("$$")) {
		reader.AdvanceToEOL()
		return parser.Close
	}
	seg := text.NewSegment(segment.Start, segment.Stop)
	seg.ForceNewline = true
	node.Lines().Append(seg)
	reader.AdvanceToEOL()
	return parser.Continue | parser.NoChildren
}

func (*mathBlockParser) Close(node ast.Node, reader text.Reader, pc parser.Context) {}

func (*mathBlockParser) CanInterruptParagraph() bool { return true }

func (*mathBlockParser) CanAcceptIndentedLine() bool { return false }

// --- $inline math$ -------------------------------------------------------

var kindMathInline = ast.NewNodeKind("MathInline")

type mathInlineNode struct {
	ast.BaseInline
	latex string
}

func (n *mathInlineNode) Kind() ast.NodeKind { return kindMathInline }

func (n *mathInlineNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

// mathInlineRe follows the common rule set (Pandoc, GitHub): no space just
// inside the dollars, and the closing dollar is not followed by a digit.
var mathInlineRe = regexp.MustCompile(`^\$(?:\$([^$\n]+?)\$|([^\s$](?:[^$\n]*?[^\s$\\])?))\$(?:[^0-9]|$)`)

type mathInlineParser struct{}

func (*mathInlineParser) Trigger() []byte { return []byte{'$'} }

func (*mathInlineParser) Parse(parent ast.Node, block text.Reader, pc parser.Context) ast.Node {
	line, _ := block.PeekLine()
	m := mathInlineRe.FindSubmatchIndex(line)
	if m == nil {
		return nil
	}
	latex, end := "", 0
	if m[2] >= 0 {
		latex, end = string(line[m[2]:m[3]]), m[3]+2
	} else {
		latex, end = string(line[m[4]:m[5]]), m[5]+1
	}
	block.Advance(end)
	return &mathInlineNode{latex: latex}
}

// --- [^footnotes] --------------------------------------------------------

var (
	kindFootnoteDef = ast.NewNodeKind("FootnoteDef")
	kindFootnoteRef = ast.NewNodeKind("FootnoteRef")
	footnoteLabels  = parser.NewContextKey()
)

type footnoteDefNode struct {
	ast.BaseBlock
	label string
}

func (n *footnoteDefNode) Kind() ast.NodeKind { return kindFootnoteDef }

func (n *footnoteDefNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type footnoteRefNode struct {
	ast.BaseInline
	label string
}

func (n *footnoteRefNode) Kind() ast.NodeKind { return kindFootnoteRef }

func (n *footnoteRefNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

var footnoteDefRe = regexp.MustCompile(`^\[\^([^\s\[\]]+)\]:(?:[ \t]|\n|$)`)

// footnoteDefParser reads "[^label]: text" with 4-space indented
// continuation lines, like goldmark's footnote extension, but keeps the
// definition where the file had it instead of moving it to the end.
type footnoteDefParser struct{}

func (*footnoteDefParser) Trigger() []byte { return []byte{'['} }

func (*footnoteDefParser) Open(parent ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, segment := reader.PeekLine()
	pos := pc.BlockOffset()
	if pos < 0 {
		return nil, parser.NoChildren
	}
	m := footnoteDefRe.FindSubmatchIndex(line[pos:])
	if m == nil {
		return nil, parser.NoChildren
	}
	node := &footnoteDefNode{label: string(line[pos+m[2] : pos+m[3]])}
	labels, _ := pc.Get(footnoteLabels).(map[string]bool)
	if labels == nil {
		labels = map[string]bool{}
		pc.Set(footnoteLabels, labels)
	}
	labels[node.label] = true
	end := pos + m[1]
	if end >= len(line)-1 {
		reader.AdvanceToEOL()
		return node, parser.HasChildren
	}
	reader.AdvanceAndSetPadding(end-segment.Padding, segment.Padding)
	return node, parser.HasChildren
}

func (*footnoteDefParser) Continue(node ast.Node, reader text.Reader, pc parser.Context) parser.State {
	line, _ := reader.PeekLine()
	if util.IsBlank(line) {
		return parser.Continue | parser.HasChildren
	}
	childpos, padding := util.IndentPosition(line, reader.LineOffset(), 4)
	if childpos < 0 {
		return parser.Close
	}
	reader.AdvanceAndSetPadding(childpos, padding)
	return parser.Continue | parser.HasChildren
}

func (*footnoteDefParser) Close(node ast.Node, reader text.Reader, pc parser.Context) {}

func (*footnoteDefParser) CanInterruptParagraph() bool { return true }

func (*footnoteDefParser) CanAcceptIndentedLine() bool { return false }

var footnoteRefRe = regexp.MustCompile(`^\[\^([^\s\[\]]+)\]`)

// footnoteRefParser turns [^label] into a reference when the file defines
// that label; otherwise the text is left alone.
type footnoteRefParser struct{}

func (*footnoteRefParser) Trigger() []byte { return []byte{'['} }

func (*footnoteRefParser) Parse(parent ast.Node, block text.Reader, pc parser.Context) ast.Node {
	line, _ := block.PeekLine()
	m := footnoteRefRe.FindSubmatchIndex(line)
	if m == nil {
		return nil
	}
	labels, _ := pc.Get(footnoteLabels).(map[string]bool)
	label := string(line[m[2]:m[3]])
	if !labels[label] {
		return nil
	}
	block.Advance(m[1])
	return &footnoteRefNode{label: label}
}

// --- [[wiki links]] ------------------------------------------------------

var kindWikiLink = ast.NewNodeKind("WikiLink")

type wikiLinkNode struct {
	ast.BaseInline
	target, alias string
	embed         bool
}

func (n *wikiLinkNode) Kind() ast.NodeKind { return kindWikiLink }

func (n *wikiLinkNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

var wikiLinkRe = regexp.MustCompile(`^(!?)\[\[((?:\\\||[^\[\]|\n])+?)(?:\\?\|((?:\\\||[^\[\]|\n])*))?\]\]`)

type wikiLinkParser struct{}

func (*wikiLinkParser) Trigger() []byte { return []byte{'[', '!'} }

func (*wikiLinkParser) Parse(parent ast.Node, block text.Reader, pc parser.Context) ast.Node {
	line, _ := block.PeekLine()
	m := wikiLinkRe.FindSubmatchIndex(line)
	if m == nil {
		return nil
	}
	node := &wikiLinkNode{embed: m[3] > m[2], target: unescapePipes(string(line[m[4]:m[5]]))}
	if m[6] >= 0 {
		node.alias = unescapePipes(string(line[m[6]:m[7]]))
	}
	block.Advance(m[1])
	return node
}

// Inside a table cell the alias separator is written \| so it does not end
// the cell; goldmark hands the cell text over with the backslash kept.
func unescapePipes(s string) string {
	return string(bytes.ReplaceAll([]byte(s), []byte(`\|`), []byte(`|`)))
}
