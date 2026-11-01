package chat

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"os"

	"golang.org/x/image/draw"
)

const (
	// maxImageEdge is the longest side a photo is stored and sent at. The
	// image model reads up to 2576 px on the long edge and shrinks larger ones
	// itself, so nothing it can read is lost; Anthropic refuses sides over 8000 px.
	maxImageEdge = 2576
	// maxSentImageBytes caps one photo's base64 size. Anthropic refuses an
	// image over 10 MB of base64, and up to five photos share one request.
	maxSentImageBytes = 5 << 20
)

var (
	errImageUnreadable  = errors.New("This image could not be read")
	errImageTooDetailed = errors.New("This photo is too detailed to send, even after resizing. Crop it to the receipt and upload it again")
)

// prepareImage turns an uploaded JPEG or PNG into the JPEG Timely stores and
// sends: turned upright by its EXIF orientation, transparency flattened onto
// white, shrunk to maxImageEdge, re-encoded so EXIF and other metadata are
// dropped, and small enough in base64 for the provider.
func prepareImage(data []byte) ([]byte, error) {
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errImageUnreadable
	}
	b := decoded.Bounds()
	w, h := fitWithin(b.Dx(), b.Dy(), maxImageEdge)
	clean := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(clean, clean.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	if w == b.Dx() && h == b.Dy() {
		draw.Draw(clean, clean.Bounds(), decoded, b.Min, draw.Over)
	} else {
		draw.CatmullRom.Scale(clean, clean.Bounds(), decoded, b, draw.Over, nil)
	}
	return encodeWithin(orient(clean, exifOrientation(data)), maxSentImageBytes)
}

// encodeWithin encodes img as a JPEG, lowering the quality until its base64
// size is at most budget.
func encodeWithin(img image.Image, budget int) ([]byte, error) {
	for _, quality := range []int{90, 80, 70, 60} {
		var out bytes.Buffer
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: quality}); err != nil {
			return nil, err
		}
		if base64.StdEncoding.EncodedLen(out.Len()) <= budget {
			return out.Bytes(), nil
		}
	}
	return nil, errImageTooDetailed
}

// fitWithin shrinks w×h, keeping its shape, so neither side is over edge.
func fitWithin(w, h, edge int) (int, int) {
	if w <= edge && h <= edge {
		return w, h
	}
	if w >= h {
		return edge, max(1, int(math.Round(float64(h)*float64(edge)/float64(w))))
	}
	return max(1, int(math.Round(float64(w)*float64(edge)/float64(h)))), edge
}

// sendableImage returns a stored photo within the provider's limits. Photos
// stored before uploads were resized can be over them: those are resized here
// and saved, so a retry never sends again a photo that can only be refused.
func sendableImage(id string, data []byte) ([]byte, error) {
	config, err := jpeg.DecodeConfig(bytes.NewReader(data))
	tooWide := err == nil && max(config.Width, config.Height) > maxImageEdge
	if !tooWide && base64.StdEncoding.EncodedLen(len(data)) <= maxSentImageBytes {
		return data, nil
	}
	fitted, err := prepareImage(data)
	if err != nil {
		return nil, fmt.Errorf("A photo is too large to read, and trying again won't help. Discard these images and upload a cropped or smaller photo")
	}
	replaceStoredImage(id, fitted)
	return fitted, nil
}

// replaceStoredImage overwrites a stored photo, but never creates one: when
// the review was discarded while the photo was being resized, its file is
// gone and must stay gone. A failed write removes the file, so a cut-off copy
// is never sent; the next read asks for the photo again.
func replaceStoredImage(id string, data []byte) {
	f, err := os.OpenFile(imagePath(id), os.O_WRONLY|os.O_TRUNC, 0)
	if err != nil {
		return
	}
	_, err = f.Write(data)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(imagePath(id))
	}
}

// exifOrientation reads the Orientation tag (0x0112) of a JPEG's EXIF data:
// 1 (upright) to 8, or 1 when there is none. Phones often store a photo
// sideways and set this tag instead of turning the pixels.
func exifOrientation(data []byte) int {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return 1
	}
	for i := 2; i+4 <= len(data); {
		if data[i] != 0xFF {
			return 1
		}
		marker := data[i+1]
		switch {
		case marker == 0xFF: // fill byte
			i++
			continue
		case marker == 0x01 || (marker >= 0xD0 && marker <= 0xD8): // no length
			i += 2
			continue
		case marker == 0xDA || marker == 0xD9: // image data starts: no EXIF
			return 1
		}
		size := int(binary.BigEndian.Uint16(data[i+2:]))
		if size < 2 || i+2+size > len(data) {
			return 1
		}
		if segment := data[i+4 : i+2+size]; marker == 0xE1 && bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
			return tiffOrientation(segment[6:])
		}
		i += 2 + size
	}
	return 1
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(t[2:]) != 42 {
		return 1
	}
	ifd := order.Uint32(t[4:])
	if ifd < 8 || int64(ifd)+2 > int64(len(t)) {
		return 1
	}
	at := int(ifd)
	for k := range int(order.Uint16(t[at:])) {
		entry := at + 2 + 12*k
		if entry+12 > len(t) {
			return 1
		}
		if order.Uint16(t[entry:]) != 0x0112 {
			continue
		}
		// A SHORT: its value sits in the first two bytes of the value field.
		if v := int(order.Uint16(t[entry+8:])); order.Uint16(t[entry+2:]) == 3 && v >= 1 && v <= 8 {
			return v
		}
		return 1
	}
	return 1
}

// orient applies an EXIF orientation to img, so the result is upright.
func orient(img *image.RGBA, orientation int) *image.RGBA {
	if orientation < 2 || orientation > 8 {
		return img
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	if orientation >= 5 {
		out = image.NewRGBA(image.Rect(0, 0, h, w))
	}
	for y := range h {
		for x := range w {
			var dx, dy int
			switch orientation {
			case 2: // mirrored
				dx, dy = w-1-x, y
			case 3: // upside down
				dx, dy = w-1-x, h-1-y
			case 4: // mirrored upside down
				dx, dy = x, h-1-y
			case 5: // mirrored, turned left
				dx, dy = y, x
			case 6: // needs a quarter turn clockwise
				dx, dy = h-1-y, x
			case 7: // mirrored, turned right
				dx, dy = h-1-y, w-1-x
			case 8: // needs a quarter turn counter-clockwise
				dx, dy = y, w-1-x
			}
			from := img.PixOffset(b.Min.X+x, b.Min.Y+y)
			to := out.PixOffset(dx, dy)
			copy(out.Pix[to:to+4], img.Pix[from:from+4])
		}
	}
	return out
}
