package docfile

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func sample(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x * 40), uint8(y * 40), 0, 255})
		}
	}
	return img
}

// withOrientation puts an EXIF APP1 segment holding the orientation tag right
// after the JPEG start marker.
func withOrientation(jpg []byte, orientation byte) []byte {
	tiff := []byte{'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0}
	payload := append([]byte("Exif\x00\x00"), tiff...)
	size := len(payload) + 2
	segment := append([]byte{0xFF, 0xE1, byte(size >> 8), byte(size)}, payload...)
	out := append([]byte{}, jpg[:2]...)
	out = append(out, segment...)
	return append(out, jpg[2:]...)
}

func TestCleanRotatesAndStripsJPEG(t *testing.T) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, sample(4, 2), nil); err != nil {
		t.Fatal(err)
	}
	raw := withOrientation(buf.Bytes(), 6)
	if jpegOrientation(raw) != 6 {
		t.Fatalf("orientation not read")
	}
	out, mime, w, h, err := Clean(raw)
	if err != nil || mime != "image/jpeg" {
		t.Fatalf("clean: %v %s", err, mime)
	}
	if w != 2 || h != 4 {
		t.Fatalf("want a 2x4 photo after turning, got %dx%d", w, h)
	}
	if bytes.Contains(out, []byte("Exif")) || jpegOrientation(out) != 1 {
		t.Fatalf("EXIF kept")
	}
}

func TestCleanAcceptsPNGAndRejectsOthers(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, sample(3, 3)); err != nil {
		t.Fatal(err)
	}
	if _, mime, w, _, err := Clean(buf.Bytes()); err != nil || mime != "image/png" || w != 3 {
		t.Fatalf("png: %v %s %d", err, mime, w)
	}
	for _, bad := range [][]byte{[]byte("<svg xmlns='http://www.w3.org/2000/svg'/>"), []byte("<html>"), {}} {
		if _, _, _, _, err := Clean(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	webp := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8X"), make([]byte, 14)...)
	webp[24], webp[27] = 99, 49
	if _, mime, w, h, err := Clean(webp); err != nil || mime != "image/webp" || w != 100 || h != 50 {
		t.Fatalf("webp: %v %s %dx%d", err, mime, w, h)
	}
}

func TestIDsAreLongAndRandom(t *testing.T) {
	a, b := newID(), newID()
	if a == b || !idRe.MatchString(a) {
		t.Fatalf("bad ids %s %s", a, b)
	}
}
