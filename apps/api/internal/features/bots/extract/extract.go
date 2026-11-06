// Package extract turns a fetched body into a reading: the readable text of
// a page, the text under a CSS selector, a product's price, or a feed's
// items. It is pure: it works on bytes and never touches the network.
package extract

import (
	"bytes"
	"errors"
	"io"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
	"golang.org/x/text/encoding"
	"golang.org/x/text/transform"
)

var (
	// ErrEmpty means the body parsed but held nothing to read: no text, no
	// selector match, no price, or a feed with no items.
	ErrEmpty = errors.New("nothing to read")
	// ErrNotFeed means the body is not RSS, RDF, Atom or JSON Feed.
	ErrNotFeed = errors.New("not a feed")
)

// MaxText caps the text of one reading (bots.MaxReadingBytes).
const MaxText = 64 << 10

// Decode converts body to UTF-8. The charset comes from a BOM or the
// Content-Type header, else a <meta> in the first 1 KB. With neither, a body
// that is valid UTF-8 is kept as UTF-8, and anything else is read as
// windows-1252, as browsers do.
func Decode(body []byte, contentType string) ([]byte, error) {
	enc, _, certain := charset.DetermineEncoding(body, contentType)
	if enc == encoding.Nop || (!certain && utf8.Valid(body)) {
		return body, nil
	}
	out, err := io.ReadAll(transform.NewReader(bytes.NewReader(body), enc.NewDecoder()))
	if err != nil {
		return nil, err
	}
	return out, nil
}

func parseHTML(body []byte, contentType string) (*html.Node, error) {
	b, err := Decode(body, contentType)
	if err != nil {
		return nil, err
	}
	return html.Parse(bytes.NewReader(b))
}
