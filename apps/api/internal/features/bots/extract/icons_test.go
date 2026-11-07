package extract

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"slices"
	"testing"
)

func TestIconLinksOrder(t *testing.T) {
	page := `<!doctype html><html><head>
		<link rel="stylesheet" href="/site.css">
		<link rel="icon" href="/favicon-any.ico">
		<link rel="icon" type="image/png" sizes="16x16" href="/fav-16.png">
		<link rel="icon" type="image/png" sizes="512x512" href="/fav-512.png">
		<link rel="mask-icon" href="/mask.svg" color="#000">
		<link rel="icon" type="image/svg+xml" href="/logo.svg">
		<link rel="icon" href="/drawn.svg">
		<link rel="icon" sizes="192x192" href="/fav-192.png#x">
		<link rel="apple-touch-icon" href="/touch.png">
		<link rel="Shortcut Icon" href="//cdn.example.net/short.ico">
		<link rel="icon" href="data:image/png;base64,AAAA">
		<link rel="icon" href="javascript:alert(1)">
		<link rel="icon" href="/favicon.ico">
		<link rel="apple-touch-icon-precomposed" sizes="180x180" href="touch-180.png">
	</head><body></body></html>`
	got := IconLinks([]byte(page), "text/html; charset=utf-8", "https://www.shop.example/p/item?id=1")
	want := []string{
		"https://www.shop.example/p/touch-180.png",
		"https://www.shop.example/touch.png",
		"https://www.shop.example/fav-192.png",
		"https://www.shop.example/fav-16.png",
		"https://www.shop.example/favicon-any.ico",
		"https://www.shop.example/fav-512.png",
		"https://cdn.example.net/short.ico",
		"https://www.shop.example/favicon.ico",
	}
	if !slices.Equal(got, want) {
		t.Errorf("IconLinks:\n got %q\nwant %q", got, want)
	}

	based := `<html><head><base href="https://static.example/assets/"><link rel="icon" href="i.png"></head></html>`
	if got := IconLinks([]byte(based), "text/html", "http://blog.example/a/b"); !slices.Equal(got, []string{"https://static.example/assets/i.png", "http://blog.example/favicon.ico"}) {
		t.Errorf("base href: %q", got)
	}
	if got := IconLinks([]byte("<html><body>no links</body></html>"), "text/html", "https://news.example/"); !slices.Equal(got, []string{"https://news.example/favicon.ico"}) {
		t.Errorf("no links: %q", got)
	}
	if got := IconLinks(nil, "", "ftp://files.example/"); got != nil {
		t.Errorf("not http: %q", got)
	}
	var many bytes.Buffer
	for i := range 20 {
		many.WriteString(`<link rel="icon" href="/i` + string(rune('a'+i)) + `.ico">`)
	}
	if got := IconLinks(many.Bytes(), "text/html", "https://many.example/"); len(got) != maxIconLinks || got[len(got)-1] != "https://many.example/favicon.ico" {
		t.Errorf("capped links: %q", got)
	}
}

func square(side int, c color.Color) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, side, side))
	for y := range side {
		for x := range side {
			img.Set(x, y, c)
		}
	}
	return img
}

func pngBytes(t testing.TB, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// redrawn decodes an IconPNG result and checks it is a 64 px square.
func redrawn(t *testing.T, out []byte) image.Image {
	t.Helper()
	if !bytes.HasPrefix(out, pngMagic) || len(out) > MaxIconBytes {
		t.Fatalf("not a small PNG: %d bytes", len(out))
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != IconSize || b.Dy() != IconSize {
		t.Fatalf("redrawn at %v", b)
	}
	return img
}

// near compares within 32 per channel: a GIF palette or JPEG moves colours
// a little.
func near(c color.Color, r, g, b, a uint8) bool {
	n := color.NRGBAModel.Convert(c).(color.NRGBA)
	d := func(x, y uint8) bool { return x-y < 32 || y-x < 32 }
	return d(n.R, r) && d(n.G, g) && d(n.B, b) && d(n.A, a)
}

func TestIconPNGRedrawsAt64(t *testing.T) {
	red := color.NRGBA{R: 220, G: 30, B: 30, A: 255}
	var jpg, gf bytes.Buffer
	if err := jpeg.Encode(&jpg, square(32, red), &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	if err := gif.Encode(&gf, square(16, red), nil); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string][]byte{
		"png 16":    pngBytes(t, square(16, red)),
		"png 180":   pngBytes(t, square(180, red)),
		"jpeg 32":   jpg.Bytes(),
		"gif 16":    gf.Bytes(),
		"ico (png)": icoFile(icoPNG(pngBytes(t, square(48, red)))),
	} {
		out, err := IconPNG(body)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if img := redrawn(t, out); !near(img.At(32, 32), 220, 30, 30, 255) {
			t.Errorf("%s: centre is %v", name, img.At(32, 32))
		}
	}

	// A wide logo is fitted inside the square on a clear background.
	wide := image.NewNRGBA(image.Rect(0, 0, 128, 32))
	for y := range 32 {
		for x := range 128 {
			wide.Set(x, y, red)
		}
	}
	out, err := IconPNG(pngBytes(t, wide))
	if err != nil {
		t.Fatal(err)
	}
	img := redrawn(t, out)
	if !near(img.At(32, 32), 220, 30, 30, 255) || !near(img.At(32, 2), 0, 0, 0, 0) || !near(img.At(32, 61), 0, 0, 0, 0) {
		t.Errorf("wide logo: centre %v, top %v, bottom %v", img.At(32, 32), img.At(32, 2), img.At(32, 61))
	}
}

func TestIconPNGRefusals(t *testing.T) {
	for name, body := range map[string][]byte{
		"svg":          []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>`),
		"svg with xml": []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>`),
		"html":         []byte(`<html><body>Not found</body></html>`),
		"empty":        nil,
		"broken png":   pngMagic,
		"empty ico":    icoFile(),
	} {
		if _, err := IconPNG(body); !errors.Is(err, ErrNotImage) {
			t.Errorf("%s: got %v, want ErrNotImage", name, err)
		}
	}
}

// hugePNG is a valid PNG header that declares w×h and carries no pixels.
func hugePNG(w, h uint32) []byte {
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], w)
	binary.BigEndian.PutUint32(ihdr[4:], h)
	ihdr[8], ihdr[9] = 8, 6 // 8-bit RGBA
	chunk := func(typ string, data []byte) []byte {
		out := binary.BigEndian.AppendUint32(nil, uint32(len(data)))
		out = append(append(out, typ...), data...)
		return binary.BigEndian.AppendUint32(out, crc32.ChecksumIEEE(append([]byte(typ), data...)))
	}
	out := append([]byte(nil), pngMagic...)
	out = append(out, chunk("IHDR", ihdr)...)
	return append(out, chunk("IEND", nil)...)
}

func TestIconPNGRefusesOversizedBeforeDecode(t *testing.T) {
	// 40000×40000 RGBA would need 6.4 GB to decode; the header alone says no.
	for name, body := range map[string][]byte{
		"png":       hugePNG(40000, 40000),
		"png wide":  hugePNG(1025, 16),
		"ico (png)": icoFile(icoPNG(hugePNG(40000, 40000))),
		"ico (bmp)": icoFile(icoBMP(2048, 2048, 32, nil, nil)),
	} {
		if _, err := IconPNG(body); !errors.Is(err, ErrImageTooLarge) {
			t.Errorf("%s: got %v, want ErrImageTooLarge", name, err)
		}
	}
	// Exactly the limit is read (and fails later only for want of pixels).
	if _, err := IconPNG(hugePNG(MaxIconSide, MaxIconSide)); !errors.Is(err, ErrNotImage) {
		t.Errorf("at the limit: got %v, want ErrNotImage", err)
	}
}

func TestIconPNGTooDetailed(t *testing.T) {
	// Noise does not compress: redrawn it is over MaxIconBytes.
	noise := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	x := uint32(1)
	for i := range noise.Pix {
		x ^= x << 13
		x ^= x >> 17
		x ^= x << 5
		noise.Pix[i] = byte(x)
	}
	if _, err := IconPNG(pngBytes(t, noise)); !errors.Is(err, ErrImageTooLarge) {
		t.Errorf("noise: got %v, want ErrImageTooLarge", err)
	}
}
