// Package docfile stores images added to docs and serves them back.
//
// A file's id is 128 random bits, and GET /files/:id needs no login: an
// <img src> in the editor (web, desktop and the mobile WebView) cannot send
// the bearer token, so the unguessable id is the capability, as with links
// shared from other note apps. Uploading needs a login.
package docfile

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

const (
	MaxFileBytes = 10 << 20
	// Per account, so one person cannot fill the server's disk.
	maxAccountBytes = 1 << 30
	maxPixels       = 40_000_000
)

type File struct {
	ID        string    `gorm:"primaryKey" json:"id"`
	UserID    string    `json:"-"`
	Name      string    `json:"name"`
	Mime      string    `json:"mime"`
	Size      int       `json:"size"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Data      []byte    `json:"-"`
	CreatedAt time.Time `json:"createdAt"`
}

func (File) TableName() string { return "doc_files" }

type Service struct{ db *gorm.DB }

func New(db *gorm.DB) *Service { return &Service{db: db} }

// Routes adds the upload route to the logged-in group.
func (s *Service) Routes(protected *echo.Group) {
	protected.POST("/docs/files", s.upload)
}

// PublicRoutes adds the route that serves a file by its id.
func (s *Service) PublicRoutes(e *echo.Echo) {
	e.GET("/files/:id", s.serve)
}

var idRe = regexp.MustCompile(`^fil_[0-9a-f]{32}$`)

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return "fil_" + hex.EncodeToString(b)
}

// Clean checks that data is a PNG, JPEG, GIF or WebP image and returns the
// bytes to store. JPEG and PNG are re-encoded, which drops EXIF data such as
// the place a photo was taken; a JPEG's EXIF rotation is applied first so the
// photo still stands the right way up. GIF (to keep animation) and WebP (the
// standard library cannot decode it) are kept as they are.
func Clean(data []byte) (out []byte, mime string, width, height int, err error) {
	bad := errors.New("Use a PNG, JPEG, GIF or WebP image")
	if len(data) > MaxFileBytes {
		return nil, "", 0, 0, errors.New("Images must be 10 MB or smaller")
	}
	if isWebP(data) {
		w, h := webpSize(data)
		return data, "image/webp", w, h, nil
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", 0, 0, bad
	}
	if config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > maxPixels {
		return nil, "", 0, 0, errors.New("Images can be at most 40 megapixels")
	}
	switch format {
	case "gif":
		if _, err := gif.DecodeAll(bytes.NewReader(data)); err != nil {
			return nil, "", 0, 0, bad
		}
		return data, "image/gif", config.Width, config.Height, nil
	case "png":
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, "", 0, 0, bad
		}
		var buf bytes.Buffer
		if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, img); err != nil {
			return nil, "", 0, 0, err
		}
		// Keep the original when re-encoding only made it bigger; a PNG
		// carries little beyond the pixels.
		if buf.Len() > len(data) && !pngHasText(data) {
			return data, "image/png", config.Width, config.Height, nil
		}
		return buf.Bytes(), "image/png", config.Width, config.Height, nil
	case "jpeg":
		img, err := jpeg.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, "", 0, 0, bad
		}
		img = orient(img, jpegOrientation(data))
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
			return nil, "", 0, 0, err
		}
		b := img.Bounds()
		return buf.Bytes(), "image/jpeg", b.Dx(), b.Dy(), nil
	}
	return nil, "", 0, 0, bad
}

func (s *Service) upload(c *echo.Context) error {
	userID, _ := c.Get("userID").(string)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, MaxFileBytes+(1<<20))
	header, err := c.FormFile("file")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Choose an image up to 10 MB")
	}
	if form := c.Request().MultipartForm; form != nil {
		defer form.RemoveAll()
	}
	src, err := header.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	data, err := io.ReadAll(io.LimitReader(src, MaxFileBytes+1))
	if err != nil {
		return err
	}
	clean, mime, width, height, err := Clean(data)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	name := []rune(strings.TrimSpace(filepath.Base(header.Filename)))
	if len(name) > 150 {
		name = name[:150]
	}
	file := File{
		ID: newID(), UserID: userID, Name: string(name), Mime: mime,
		Size: len(clean), Width: width, Height: height, Data: clean, CreatedAt: time.Now().UTC(),
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// One upload at a time per account, so parallel uploads cannot pass the quota together.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "doc_files:"+userID).Error; err != nil {
			return err
		}
		var used int64
		if err := tx.Model(&File{}).Where("user_id = ?", userID).Select("COALESCE(SUM(size), 0)").Scan(&used).Error; err != nil {
			return err
		}
		if used+int64(file.Size) > maxAccountBytes {
			return echo.NewHTTPError(http.StatusBadRequest, "Doc images are limited to 1 GB per account")
		}
		return tx.Create(&file).Error
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, map[string]any{
		"id": file.ID, "url": "/files/" + file.ID, "name": file.Name, "mime": file.Mime,
		"size": file.Size, "width": file.Width, "height": file.Height,
	})
}

func (s *Service) serve(c *echo.Context) error {
	id := c.Param("id")
	if !idRe.MatchString(id) {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}
	var file File
	if err := s.db.Select("id", "mime", "data").Where("id = ?", id).First(&file).Error; err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "File not found")
	}
	h := c.Response().Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	// A file never changes once uploaded.
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	return c.Blob(http.StatusOK, file.Mime, file.Data)
}

func isWebP(data []byte) bool {
	return len(data) >= 16 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" &&
		(string(data[12:16]) == "VP8 " || string(data[12:16]) == "VP8L" || string(data[12:16]) == "VP8X")
}

// webpSize reads the canvas size from a WebP header; 0 when it cannot.
func webpSize(data []byte) (int, int) {
	switch string(data[12:16]) {
	case "VP8X":
		if len(data) >= 30 {
			w := 1 + (int(data[24]) | int(data[25])<<8 | int(data[26])<<16)
			h := 1 + (int(data[27]) | int(data[28])<<8 | int(data[29])<<16)
			return w, h
		}
	case "VP8 ":
		if len(data) >= 30 {
			return int(data[26]) | int(data[27]&0x3f)<<8, int(data[28]) | int(data[29]&0x3f)<<8
		}
	case "VP8L":
		if len(data) >= 25 {
			b := uint32(data[21]) | uint32(data[22])<<8 | uint32(data[23])<<16 | uint32(data[24])<<24
			return int(b&0x3fff) + 1, int((b>>14)&0x3fff) + 1
		}
	}
	return 0, 0
}

// pngHasText reports whether a PNG holds text or EXIF chunks worth dropping.
func pngHasText(data []byte) bool {
	for i := 8; i+8 <= len(data); {
		n := int(uint32(data[i])<<24 | uint32(data[i+1])<<16 | uint32(data[i+2])<<8 | uint32(data[i+3]))
		kind := string(data[i+4 : i+8])
		if kind == "tEXt" || kind == "iTXt" || kind == "zTXt" || kind == "eXIf" {
			return true
		}
		if n < 0 || i+12+n > len(data) {
			return false
		}
		i += 12 + n
	}
	return false
}
