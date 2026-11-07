package extract

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/draw"
	"image/png"

	"golang.org/x/image/bmp"
)

// decodeICO decodes the largest image in an ICO file that is at most
// maxSide on each side. An entry is a PNG, or a BMP without its file
// header whose height counts the AND mask too. Every entry's size is read
// before anything is decoded.
func decodeICO(data []byte, maxSide int) (image.Image, error) {
	if len(data) < 6 || binary.LittleEndian.Uint16(data[0:]) != 0 || binary.LittleEndian.Uint16(data[2:]) != 1 {
		return nil, ErrNotImage
	}
	count := int(binary.LittleEndian.Uint16(data[4:]))
	var best []byte
	var bestCfg image.Config
	tooLarge := false
	for i := range count {
		dir := 6 + 16*i
		if dir+16 > len(data) {
			break
		}
		size, offset := binary.LittleEndian.Uint32(data[dir+8:]), binary.LittleEndian.Uint32(data[dir+12:])
		if uint64(offset)+uint64(size) > uint64(len(data)) || size < 40 {
			continue
		}
		entry := data[offset : offset+size]
		cfg, err := icoEntryConfig(entry)
		if err != nil {
			continue
		}
		if cfg.Width > maxSide || cfg.Height > maxSide {
			tooLarge = true
			continue
		}
		if best == nil || cfg.Width*cfg.Height > bestCfg.Width*bestCfg.Height {
			best, bestCfg = entry, cfg
		}
	}
	if best == nil {
		if tooLarge {
			return nil, ErrImageTooLarge
		}
		return nil, ErrNotImage
	}
	if bytes.HasPrefix(best, pngMagic) {
		return png.Decode(bytes.NewReader(best))
	}
	return decodeICOBitmap(best, bestCfg)
}

// icoEntryConfig is an entry's real size: a PNG's header, or the bitmap
// header's width and half its height.
func icoEntryConfig(e []byte) (image.Config, error) {
	if bytes.HasPrefix(e, pngMagic) {
		return png.DecodeConfig(bytes.NewReader(e))
	}
	if binary.LittleEndian.Uint32(e[0:]) != 40 {
		return image.Config{}, ErrNotImage
	}
	w, h := int32(binary.LittleEndian.Uint32(e[4:])), int32(binary.LittleEndian.Uint32(e[8:]))
	if w <= 0 || h <= 0 || h%2 != 0 {
		return image.Config{}, ErrNotImage
	}
	return image.Config{Width: int(w), Height: int(h / 2)}, nil
}

// decodeICOBitmap gives a bitmap entry the file header x/image/bmp wants,
// with the mask taken out of its height, then applies the transparency: a
// 32-bit entry's own alpha, else the AND mask (a set bit is transparent).
func decodeICOBitmap(e []byte, cfg image.Config) (image.Image, error) {
	bpp := int(binary.LittleEndian.Uint16(e[14:]))
	colors := int(binary.LittleEndian.Uint32(e[32:]))
	if bpp <= 8 && colors == 0 {
		colors = 1 << bpp
	}
	if bpp > 8 {
		colors = 0
	}
	pixels := 40 + 4*colors
	patched := append([]byte(nil), e...)
	binary.LittleEndian.PutUint32(patched[8:], uint32(cfg.Height))
	header := make([]byte, 14, 14+len(patched))
	copy(header, "BM")
	binary.LittleEndian.PutUint32(header[2:], uint32(14+len(patched)))
	binary.LittleEndian.PutUint32(header[10:], uint32(14+pixels))
	img, err := bmp.Decode(bytes.NewReader(append(header, patched...)))
	if err != nil {
		return nil, err
	}
	out := image.NewNRGBA(image.Rect(0, 0, cfg.Width, cfg.Height))
	draw.Draw(out, out.Bounds(), img, img.Bounds().Min, draw.Src)
	rowBytes := (cfg.Width*bpp + 31) / 32 * 4
	if bpp == 32 {
		hasAlpha := false
		for y := range cfg.Height {
			row := e[pixels+(cfg.Height-1-y)*rowBytes:]
			for x := range cfg.Width {
				a := row[4*x+3]
				out.Pix[y*out.Stride+4*x+3] = a
				hasAlpha = hasAlpha || a != 0
			}
		}
		if hasAlpha {
			return out, nil
		}
		for i := 3; i < len(out.Pix); i += 4 {
			out.Pix[i] = 0xff
		}
	}
	mask, maskRow := pixels+rowBytes*cfg.Height, (cfg.Width+31)/32*4
	if mask+maskRow*cfg.Height > len(e) {
		return out, nil // no mask: opaque
	}
	for y := range cfg.Height {
		row := e[mask+(cfg.Height-1-y)*maskRow:]
		for x := range cfg.Width {
			if row[x/8]&(0x80>>(x%8)) != 0 {
				out.Pix[y*out.Stride+4*x+3] = 0
			}
		}
	}
	return out, nil
}
