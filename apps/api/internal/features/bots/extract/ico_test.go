package extract

import (
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"testing"
)

// icoEntry is one image inside an ICO file, as stored.
type icoEntry struct {
	w, h int
	data []byte
}

func icoPNG(data []byte) icoEntry { return icoEntry{data: data} }

// icoBMP is a bitmap entry: a BITMAPINFOHEADER with the height doubled,
// the palette (bpp 8), the pixel rows bottom-up and the AND mask. pixel
// gives each pixel as BGRA (bpp 32 or 24) or a palette index (bpp 8); a
// nil pixel leaves the data out, as a lying header would.
func icoBMP(w, h, bpp int, pixel func(x, y int) []byte, masked func(x, y int) bool) icoEntry {
	head := make([]byte, 40)
	binary.LittleEndian.PutUint32(head[0:], 40)
	binary.LittleEndian.PutUint32(head[4:], uint32(w))
	binary.LittleEndian.PutUint32(head[8:], uint32(2*h))
	binary.LittleEndian.PutUint16(head[12:], 1)
	binary.LittleEndian.PutUint16(head[14:], uint16(bpp))
	data := head
	if bpp == 8 {
		binary.LittleEndian.PutUint32(head[32:], 2)
		data = append(data, 0x20, 0x40, 0xe0, 0, 0xff, 0xff, 0xff, 0) // 0: BGR red-ish, 1: white
	}
	if pixel == nil {
		return icoEntry{w: w, h: h, data: data}
	}
	row := (w*bpp + 31) / 32 * 4
	for y := h - 1; y >= 0; y-- {
		line := make([]byte, row)
		for x := range w {
			p := pixel(x, y)
			copy(line[x*bpp/8:], p)
		}
		data = append(data, line...)
	}
	maskRow := (w + 31) / 32 * 4
	for y := h - 1; y >= 0; y-- {
		line := make([]byte, maskRow)
		for x := range w {
			if masked != nil && masked(x, y) {
				line[x/8] |= 0x80 >> (x % 8)
			}
		}
		data = append(data, line...)
	}
	return icoEntry{w: w, h: h, data: data}
}

func icoFile(entries ...icoEntry) []byte {
	out := []byte{0, 0, 1, 0}
	out = binary.LittleEndian.AppendUint16(out, uint16(len(entries)))
	offset := 6 + 16*len(entries)
	for _, e := range entries {
		out = append(out, byte(e.w), byte(e.h), 0, 0, 1, 0, 32, 0)
		out = binary.LittleEndian.AppendUint32(out, uint32(len(e.data)))
		out = binary.LittleEndian.AppendUint32(out, uint32(offset))
		offset += len(e.data)
	}
	for _, e := range entries {
		out = append(out, e.data...)
	}
	return out
}

func TestICOPicksTheLargestPNGEntry(t *testing.T) {
	blue, green := color.NRGBA{B: 255, A: 255}, color.NRGBA{G: 255, A: 255}
	f := icoFile(icoPNG(pngBytes(t, square(16, blue))), icoPNG(pngBytes(t, square(48, green))), icoPNG(pngBytes(t, square(32, blue))))
	img, err := decodeICO(f, MaxIconSide)
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 48 || !near(img.At(5, 5), 0, 255, 0, 255) {
		t.Errorf("picked %v %v", img.Bounds(), img.At(5, 5))
	}
	// An entry over the limit is skipped for a smaller one.
	f = icoFile(icoPNG(hugePNG(4096, 4096)), icoPNG(pngBytes(t, square(16, blue))))
	if img, err := decodeICO(f, MaxIconSide); err != nil || img.Bounds().Dx() != 16 {
		t.Errorf("skipping the huge entry: %v %v", err, img)
	}
}

func TestICOBitmapEntries(t *testing.T) {
	// 32-bit: its own alpha. The left half is clear, the right half solid.
	alpha := icoBMP(16, 16, 32, func(x, _ int) []byte {
		if x < 8 {
			return []byte{0, 0, 0, 0}
		}
		return []byte{0x10, 0x80, 0xf0, 0xff} // BGRA
	}, nil)
	// 24-bit: the AND mask makes the top row clear.
	masked := icoBMP(16, 16, 24, func(int, int) []byte { return []byte{0xff, 0, 0} }, func(_, y int) bool { return y == 0 })
	// 8-bit paletted, with a mask on the first column.
	paletted := icoBMP(8, 8, 8, func(x, _ int) []byte { return []byte{byte(x % 2)} }, func(x, _ int) bool { return x == 0 })
	// 32-bit with no alpha at all falls back to the mask.
	noAlpha := icoBMP(4, 4, 32, func(int, int) []byte { return []byte{0, 0xff, 0, 0} }, func(x, y int) bool { return x == 3 && y == 3 })

	for _, c := range []struct {
		name  string
		entry icoEntry
		check map[image.Point]color.NRGBA
	}{
		{"32-bit alpha", alpha, map[image.Point]color.NRGBA{{2, 2}: {}, {12, 2}: {R: 0xf0, G: 0x80, B: 0x10, A: 0xff}}},
		{"24-bit mask", masked, map[image.Point]color.NRGBA{{3, 0}: {}, {3, 1}: {B: 0xff, A: 0xff}, {3, 15}: {B: 0xff, A: 0xff}}},
		{"8-bit palette", paletted, map[image.Point]color.NRGBA{{0, 4}: {}, {2, 4}: {R: 0xe0, G: 0x40, B: 0x20, A: 0xff}, {3, 4}: {R: 0xff, G: 0xff, B: 0xff, A: 0xff}}},
		{"32-bit no alpha", noAlpha, map[image.Point]color.NRGBA{{0, 0}: {G: 0xff, A: 0xff}, {3, 3}: {}}},
	} {
		img, err := decodeICO(icoFile(c.entry), MaxIconSide)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if b := img.Bounds(); b.Dx() != c.entry.w || b.Dy() != c.entry.h {
			t.Fatalf("%s: bounds %v", c.name, b)
		}
		for p, want := range c.check {
			got := color.NRGBAModel.Convert(img.At(p.X, p.Y)).(color.NRGBA)
			if want.A == 0 {
				if got.A != 0 {
					t.Errorf("%s at %v: %v, want clear", c.name, p, got)
				}
				continue
			}
			if got != want {
				t.Errorf("%s at %v: %v, want %v", c.name, p, got, want)
			}
		}
		if _, err := IconPNG(icoFile(c.entry)); err != nil {
			t.Errorf("%s: IconPNG: %v", c.name, err)
		}
	}

	// A PNG entry and a larger bitmap: the bitmap wins on size.
	f := icoFile(icoPNG(pngBytes(t, square(8, color.NRGBA{R: 255, A: 255}))), masked)
	if img, err := decodeICO(f, MaxIconSide); err != nil || img.Bounds().Dx() != 16 {
		t.Errorf("larger bitmap: %v %v", err, img)
	}
}

func TestICOBroken(t *testing.T) {
	good := icoFile(icoBMP(4, 4, 24, func(int, int) []byte { return []byte{1, 2, 3} }, nil))
	cursor := append([]byte(nil), good...)
	cursor[2] = 2
	pastEnd := append([]byte(nil), good...)
	binary.LittleEndian.PutUint32(pastEnd[6+8:], 1<<30)
	oddHeight := append([]byte(nil), good...)
	binary.LittleEndian.PutUint32(oddHeight[22+8:], 7)
	for name, f := range map[string][]byte{
		"short":          {0, 0, 1},
		"cursor":         cursor,
		"entry past end": pastEnd,
		"odd height":     oddHeight,
		"no pixels":      icoFile(icoBMP(4, 4, 24, nil, nil)),
		"16-bit":         icoFile(icoBMP(4, 4, 16, func(int, int) []byte { return []byte{1, 2} }, nil)),
	} {
		if _, err := decodeICO(f, MaxIconSide); err == nil {
			t.Errorf("%s: decoded", name)
		}
		if _, err := IconPNG(f); !errors.Is(err, ErrNotImage) {
			t.Errorf("%s: IconPNG gave %v", name, err)
		}
	}
}

// FuzzIconPNG feeds anything to the logo decoder: it never panics, and what
// it accepts is always a 64 px PNG within MaxIconBytes.
func FuzzIconPNG(f *testing.F) {
	f.Add(icoFile(icoBMP(4, 4, 24, func(int, int) []byte { return []byte{1, 2, 3} }, func(x, _ int) bool { return x == 1 })))
	f.Add(icoFile(icoBMP(3, 2, 8, func(x, _ int) []byte { return []byte{byte(x % 2)} }, nil)))
	f.Add(icoFile(icoBMP(2, 2, 32, func(int, int) []byte { return []byte{1, 2, 3, 4} }, nil)))
	f.Add(icoFile(icoPNG(pngBytes(f, square(4, color.NRGBA{R: 9, A: 255})))))
	f.Add(icoFile(icoBMP(2048, 2048, 32, nil, nil)))
	f.Add(pngBytes(f, square(3, color.NRGBA{G: 9, A: 128})))
	f.Add(hugePNG(5000, 5000))
	f.Add([]byte("GIF89a"))
	f.Add([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "))
	f.Add([]byte("BM"))
	f.Add([]byte{0, 0, 1, 0, 1, 0})
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 64<<10 {
			return
		}
		out, err := IconPNG(data)
		if err != nil {
			return
		}
		img, err := decodeIcon(out)
		if err != nil || img.Bounds().Dx() != IconSize || img.Bounds().Dy() != IconSize || len(out) > MaxIconBytes {
			t.Fatalf("accepted %d bytes and gave %d bytes: %v", len(data), len(out), err)
		}
	})
}
