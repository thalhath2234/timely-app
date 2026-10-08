package richtext

import (
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// ==highlight== is not CommonMark or GFM, but the editor has a highlight mark
// and the web/mobile importer reads it, so the server parses it the same way.
// Built like goldmark's strikethrough extension.

var kindHighlight = ast.NewNodeKind("Highlight")

type highlightNode struct{ ast.BaseInline }

func (n *highlightNode) Kind() ast.NodeKind { return kindHighlight }

func (n *highlightNode) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type highlightDelimiter struct{}

func (highlightDelimiter) IsDelimiter(b byte) bool { return b == '=' }

func (highlightDelimiter) CanOpenCloser(opener, closer *parser.Delimiter) bool {
	return opener.Char == closer.Char
}

func (highlightDelimiter) OnMatch(consumes int) ast.Node { return &highlightNode{} }

type highlightParser struct{}

func (*highlightParser) Trigger() []byte { return []byte{'='} }

func (*highlightParser) Parse(parent ast.Node, block text.Reader, pc parser.Context) ast.Node {
	before := block.PrecendingCharacter()
	line, segment := block.PeekLine()
	node := parser.ScanDelimiter(line, before, 2, highlightDelimiter{})
	if node == nil || node.OriginalLength != 2 || before == '=' {
		return nil
	}
	node.Segment = segment.WithStop(segment.Start + node.OriginalLength)
	block.Advance(node.OriginalLength)
	pc.PushDelimiter(node)
	return node
}

func (*highlightParser) CloseBlock(parent ast.Node, pc parser.Context) {}
