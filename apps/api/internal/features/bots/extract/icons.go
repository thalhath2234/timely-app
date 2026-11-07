package extract

import (
	"bytes"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const (
	// IconSize is the side of the square PNG a logo is redrawn as.
	IconSize = 64
	// MaxIconSide is the largest side a logo may declare; anything bigger
	// is refused before it is decoded, so a small file cannot claim a size
	// that exhausts memory.
	MaxIconSide = 1024
	// MaxIconBytes bounds the redrawn PNG (bot_site_icons.body).
	MaxIconBytes = 16 << 10
	// maxIconLinks caps the addresses IconLinks gives, /favicon.ico included.
	maxIconLinks = 8
	// bestIconSide is the largest declared size preferred among PNG icons.
	bestIconSide = 256
)

var (
	// ErrNotImage is a body that is not a PNG, ICO, JPEG, GIF, WebP or BMP.
	// SVG is one: it can carry script and would need a renderer to redraw.
	ErrNotImage = errors.New("not an image Timely reads")
	// ErrImageTooLarge is an image that declares a side over MaxIconSide, or
	// one that does not fit MaxIconBytes once redrawn.
	ErrImageTooLarge = errors.New("the image is too large")
)

var pngMagic = []byte("\x89PNG\r\n\x1a\n")

// IconLinks lists the addresses a page names for its logo, best first:
// apple-touch-icon, then rel=icon PNGs by their largest declared size up to
// 256, then any other rel=icon, then /favicon.ico at the page's origin.
// SVG links (and mask-icon, which is SVG) are left out, and so is anything
// that is not http or https. pageURL resolves relative links, after the
// page's own <base href>.
func IconLinks(body []byte, contentType, pageURL string) []string {
	page, err := url.Parse(pageURL)
	if err != nil || (page.Scheme != "http" && page.Scheme != "https") || page.Host == "" {
		return nil
	}
	type link struct {
		href  string
		group int // 0 apple-touch-icon, 1 sized PNG icon, 2 other icon
		side  int // the largest declared size; 0 when none
		order int
	}
	var links []link
	base, baseSet := page, false
	if doc, err := parseHTML(body, contentType); err == nil {
		var walk func(*html.Node)
		walk = func(n *html.Node) {
			if n.Type == html.ElementNode && n.Namespace == "" {
				switch n.DataAtom {
				case atom.Base:
					// The first <base href> counts, as in a browser.
					if href := strings.TrimSpace(attr(n, "href")); href != "" && !baseSet {
						if b, err := page.Parse(href); err == nil {
							base, baseSet = b, true
						}
					}
				case atom.Link:
					rels := strings.Fields(strings.ToLower(attr(n, "rel")))
					apple := slices.Contains(rels, "apple-touch-icon") || slices.Contains(rels, "apple-touch-icon-precomposed")
					if !apple && !slices.Contains(rels, "icon") {
						break
					}
					ref := strings.TrimSpace(attr(n, "href"))
					u, err := base.Parse(ref)
					if ref == "" || err != nil || (u.Scheme != "http" && u.Scheme != "https") {
						break
					}
					typ := strings.ToLower(strings.TrimSpace(attr(n, "type")))
					p := strings.ToLower(u.Path)
					if strings.Contains(typ, "svg") || strings.HasSuffix(p, ".svg") || strings.HasSuffix(p, ".svgz") {
						break
					}
					u.Fragment = ""
					l := link{href: u.String(), group: 2, side: largestSize(attr(n, "sizes")), order: len(links)}
					switch {
					case apple:
						l.group = 0
					case (typ == "image/png" || strings.HasSuffix(p, ".png")) && l.side > 0 && l.side <= bestIconSide:
						l.group = 1
					}
					links = append(links, l)
				}
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
		}
		walk(doc)
	}
	// rank orders sizes within a group: up to 256 largest first, then none
	// declared, then over 256 smallest first.
	rank := func(side int) int {
		switch {
		case side > bestIconSide:
			return side
		case side > 0:
			return -side
		}
		return 0
	}
	slices.SortStableFunc(links, func(a, b link) int {
		if a.group != b.group {
			return a.group - b.group
		}
		if a.group == 2 {
			return a.order - b.order
		}
		return rank(a.side) - rank(b.side)
	})
	fav := (&url.URL{Scheme: page.Scheme, Host: page.Host, Path: "/favicon.ico"}).String()
	var out []string
	for _, l := range links {
		if len(out) == maxIconLinks-1 {
			break
		}
		if l.href != fav && !slices.Contains(out, l.href) {
			out = append(out, l.href)
		}
	}
	return append(out, fav)
}

// largestSize is the largest side in a sizes attribute ("16x16 32x32");
// "any" or nothing readable is 0.
func largestSize(sizes string) int {
	best := 0
	for _, s := range strings.Fields(strings.ToLower(sizes)) {
		w, h, ok := strings.Cut(s, "x")
		if !ok {
			continue
		}
		wi, err1 := strconv.Atoi(w)
		hi, err2 := strconv.Atoi(h)
		if err1 == nil && err2 == nil && wi > 0 && hi > 0 {
			best = max(best, wi, hi)
		}
	}
	return best
}

// IconPNG redraws a logo as an IconSize square PNG: decoded by its own
// bytes (PNG, ICO, JPEG, GIF, WebP or BMP; never SVG), fitted inside the
// square on a clear background and encoded afresh, so nothing the site sent
// is kept. Its size is read before it is decoded, and any side over
// MaxIconSide is refused.
func IconPNG(body []byte) ([]byte, error) {
	img, err := decodeIcon(body)
	if err != nil {
		return nil, err
	}
	b := img.Bounds()
	if b.Dx() <= 0 || b.Dy() <= 0 {
		return nil, ErrNotImage
	}
	w, h := IconSize, IconSize
	if b.Dx() > b.Dy() {
		h = max(1, (b.Dy()*IconSize+b.Dx()/2)/b.Dx())
	} else if b.Dy() > b.Dx() {
		w = max(1, (b.Dx()*IconSize+b.Dy()/2)/b.Dy())
	}
	out := image.NewNRGBA(image.Rect(0, 0, IconSize, IconSize))
	x0, y0 := (IconSize-w)/2, (IconSize-h)/2
	draw.CatmullRom.Scale(out, image.Rect(x0, y0, x0+w, y0+h), img, b, draw.Over, nil)
	var buf bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, out); err != nil {
		return nil, err
	}
	if buf.Len() > MaxIconBytes {
		return nil, ErrImageTooLarge
	}
	return buf.Bytes(), nil
}

// codec is one image format: how to read its size, and how to decode it.
type codec struct {
	config func(io.Reader) (image.Config, error)
	decode func(io.Reader) (image.Image, error)
}

// decodeIcon picks the decoder by the body's first bytes, and checks the
// declared size with DecodeConfig before decoding.
func decodeIcon(body []byte) (image.Image, error) {
	var c codec
	switch {
	case bytes.HasPrefix(body, pngMagic):
		c = codec{png.DecodeConfig, png.Decode}
	case bytes.HasPrefix(body, []byte{0, 0, 1, 0}):
		img, err := decodeICO(body, MaxIconSide)
		if err != nil && !errors.Is(err, ErrImageTooLarge) {
			return nil, ErrNotImage
		}
		return img, err
	case bytes.HasPrefix(body, []byte{0xff, 0xd8, 0xff}):
		c = codec{jpeg.DecodeConfig, jpeg.Decode}
	case bytes.HasPrefix(body, []byte("GIF87a")) || bytes.HasPrefix(body, []byte("GIF89a")):
		c = codec{gif.DecodeConfig, gif.Decode}
	case len(body) >= 12 && string(body[:4]) == "RIFF" && string(body[8:12]) == "WEBP":
		c = codec{webp.DecodeConfig, webp.Decode}
	case bytes.HasPrefix(body, []byte("BM")):
		c = codec{bmp.DecodeConfig, bmp.Decode}
	default:
		return nil, ErrNotImage
	}
	cfg, err := c.config(bytes.NewReader(body))
	if err != nil {
		return nil, ErrNotImage
	}
	if cfg.Width > MaxIconSide || cfg.Height > MaxIconSide {
		return nil, ErrImageTooLarge
	}
	img, err := c.decode(bytes.NewReader(body))
	if err != nil {
		return nil, ErrNotImage
	}
	return img, nil
}
