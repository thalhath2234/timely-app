package chat

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"testing"
)

// markedPhoto is a 40x20 JPEG with a red block at its top-left and a blue one
// at its top-right, tagged with the given EXIF orientation (0: no EXIF).
func markedPhoto(t *testing.T, orientation int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 40, 20))
	for y := range 20 {
		for x := range 40 {
			c := color.RGBA{255, 255, 255, 255}
			if y < 10 && x < 10 {
				c = color.RGBA{255, 0, 0, 255}
			} else if y < 10 && x >= 30 {
				c = color.RGBA{0, 0, 255, 255}
			}
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	if orientation == 0 {
		return buf.Bytes()
	}
	return withOrientation(buf.Bytes(), orientation)
}

// withOrientation inserts a minimal EXIF APP1 segment after the JPEG's SOI.
func withOrientation(jpg []byte, orientation int) []byte {
	tiff := []byte{'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, byte(orientation), 0, 0, 0, 0, 0, 0, 0}
	payload := append([]byte("Exif\x00\x00"), tiff...)
	segment := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(segment[2:], uint16(len(payload)+2))
	out := append([]byte{}, jpg[:2]...)
	out = append(out, segment...)
	out = append(out, payload...)
	return append(out, jpg[2:]...)
}

func cornerOf(img image.Image, want func(r, g, b uint32) bool) string {
	b := img.Bounds()
	for name, p := range map[string]image.Point{"TL": {4, 4}, "TR": {b.Dx() - 5, 4}, "BL": {4, b.Dy() - 5}, "BR": {b.Dx() - 5, b.Dy() - 5}} {
		r, g, bl, _ := img.At(p.X, p.Y).RGBA()
		if want(r>>8, g>>8, bl>>8) {
			return name
		}
	}
	return "?"
}

func TestPreparedPhotosAreUpright(t *testing.T) {
	red := func(r, g, b uint32) bool { return r > 200 && g < 80 && b < 80 }
	blue := func(r, g, b uint32) bool { return b > 200 && r < 80 && g < 80 }
	// Where each block must end up, as PIL's ImageOps.exif_transpose puts them.
	for orientation, want := range map[int]struct {
		w, h      int
		red, blue string
	}{
		0: {40, 20, "TL", "TR"}, 1: {40, 20, "TL", "TR"}, 2: {40, 20, "TR", "TL"}, 3: {40, 20, "BR", "BL"}, 4: {40, 20, "BL", "BR"},
		5: {20, 40, "TL", "BL"}, 6: {20, 40, "TR", "BR"}, 7: {20, 40, "BR", "TR"}, 8: {20, 40, "BL", "TL"},
	} {
		prepared, err := prepareImage(markedPhoto(t, orientation))
		if err != nil {
			t.Fatal(err)
		}
		if exifOrientation(prepared) != 1 || bytes.Contains(prepared, []byte("Exif\x00\x00")) {
			t.Fatalf("orientation %d: EXIF kept", orientation)
		}
		img, err := jpeg.Decode(bytes.NewReader(prepared))
		if err != nil {
			t.Fatal(err)
		}
		size := img.Bounds().Size()
		if size.X != want.w || size.Y != want.h || cornerOf(img, red) != want.red || cornerOf(img, blue) != want.blue {
			t.Fatalf("orientation %d: %v red %s blue %s, want %dx%d red %s blue %s", orientation, size, cornerOf(img, red), cornerOf(img, blue), want.w, want.h, want.red, want.blue)
		}
	}
}

func TestExifOrientationIgnoresBrokenData(t *testing.T) {
	photo := withOrientation(markedPhoto(t, 0), 6)
	for name, data := range map[string][]byte{
		"empty":       nil,
		"png":         []byte("\x89PNG\r\n\x1a\n...."),
		"cut off":     photo[:12],
		"bad value":   withOrientation(markedPhoto(t, 0), 9),
		"no exif":     markedPhoto(t, 0),
		"bad segment": {0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF, 'E'},
	} {
		if got := exifOrientation(data); got != 1 {
			t.Fatalf("%s: orientation %d", name, got)
		}
	}
	if exifOrientation(photo) != 6 {
		t.Fatal("orientation 6 not read")
	}
}

// photoOfSize is a w×h JPEG with soft stripes, like a long receipt.
func photoOfSize(t *testing.T, w, h int, noisy bool) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	seed := uint32(1)
	for y := range h {
		for x := range w {
			v := uint8(200 + (x/7+y/11)%50)
			r, g, b := v, v, v^0x55
			if noisy {
				seed = seed*1664525 + 1013904223
				r, g, b = uint8(seed>>24), uint8(seed>>16), uint8(seed>>8)
			}
			i := img.PixOffset(x, y)
			img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = r, g, b, 255
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestPreparedPhotosFitTheProviderLimits(t *testing.T) {
	// A 10000×2000 panorama was refused for its 8000 px side; a 4472×4472
	// photo for its base64 size. Both are now shrunk, keeping their shape.
	for _, size := range []image.Point{{10000, 2000}, {1500, 6000}, {4472, 4472}, {800, 600}} {
		prepared, err := prepareImage(photoOfSize(t, size.X, size.Y, false))
		if err != nil {
			t.Fatal(err)
		}
		config, err := jpeg.DecodeConfig(bytes.NewReader(prepared))
		if err != nil {
			t.Fatal(err)
		}
		wantW, wantH := fitWithin(size.X, size.Y, maxImageEdge)
		if config.Width != wantW || config.Height != wantH || max(config.Width, config.Height) > maxImageEdge {
			t.Fatalf("%v: stored %dx%d, want %dx%d", size, config.Width, config.Height, wantW, wantH)
		}
		if size.X <= maxImageEdge && size.Y <= maxImageEdge && (wantW != size.X || wantH != size.Y) {
			t.Fatalf("%v: a photo within the limits was resized", size)
		}
		if n := base64.StdEncoding.EncodedLen(len(prepared)); n > maxSentImageBytes {
			t.Fatalf("%v: %d base64 bytes", size, n)
		}
	}
	if w, h := fitWithin(10000, 2000, maxImageEdge); w != 2576 || h != 515 {
		t.Fatalf("panorama fits as %dx%d", w, h)
	}
}

func TestDetailedPhotoIsEncodedWithinTheSizeBudget(t *testing.T) {
	noise, err := jpeg.Decode(bytes.NewReader(photoOfSize(t, 600, 600, true)))
	if err != nil {
		t.Fatal(err)
	}
	best, err := encodeWithin(noise, maxSentImageBytes)
	if err != nil {
		t.Fatal(err)
	}
	// One byte under the best quality's size: a lower quality must fit.
	budget := base64.StdEncoding.EncodedLen(len(best)) - 1
	smaller, err := encodeWithin(noise, budget)
	if err != nil || base64.StdEncoding.EncodedLen(len(smaller)) > budget {
		t.Fatalf("err %v, %d bytes for a budget of %d", err, len(smaller), budget)
	}
	if _, err := encodeWithin(noise, 1000); !errors.Is(err, errImageTooDetailed) {
		t.Fatalf("err = %v, want the too-detailed error", err)
	}
}

func TestStoredOversizedPhotoIsResizedBeforeItIsSent(t *testing.T) {
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	legacy := photoOfSize(t, 9000, 1000, false)
	if err := os.WriteFile(imagePath("img_legacy"), legacy, 0600); err != nil {
		t.Fatal(err)
	}
	sent, err := sendableImage("img_legacy", legacy)
	if err != nil {
		t.Fatal(err)
	}
	config, _ := jpeg.DecodeConfig(bytes.NewReader(sent))
	stored, _ := os.ReadFile(imagePath("img_legacy"))
	if config.Width != maxImageEdge || !bytes.Equal(stored, sent) {
		t.Fatalf("sent %dx%d; stored copy updated: %v", config.Width, config.Height, bytes.Equal(stored, sent))
	}
	small := markedPhoto(t, 0)
	if same, err := sendableImage("img_small", small); err != nil || !bytes.Equal(same, small) {
		t.Fatal("a photo within the limits must be sent as stored")
	}
}

func TestResizingNeverBringsBackADiscardedPhoto(t *testing.T) {
	// The review was discarded while the stored photo was being resized:
	// eraseImages removed its file, and saving the resized copy must not
	// write it again.
	t.Setenv("CHAT_IMAGE_DIR", t.TempDir())
	legacy := photoOfSize(t, 9000, 1000, false)
	sent, err := sendableImage("img_discarded", legacy)
	if err != nil || len(sent) == 0 {
		t.Fatalf("err = %v", err)
	}
	if _, err := os.Stat(imagePath("img_discarded")); !os.IsNotExist(err) {
		t.Fatalf("the discarded photo's file is back: %v", err)
	}
}
