package models

import (
	"database/sql/driver"
	"fmt"
	"strconv"
	"strings"
)

// Vector is an embedding stored as a PostgreSQL real[] (ADR 0011: no
// pgvector). Value writes the array literal {1,2,3}; Scan reads it back.
type Vector []float32

// Value renders the Postgres array literal.
func (v Vector) Value() (driver.Value, error) {
	if v == nil {
		return nil, nil
	}
	var b strings.Builder
	b.Grow(len(v)*10 + 2)
	b.WriteByte('{')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'g', -1, 32))
	}
	b.WriteByte('}')
	return b.String(), nil
}

// Scan parses the {…} literal pgx returns for real[] in text format.
func (v *Vector) Scan(src any) error {
	var text string
	switch value := src.(type) {
	case nil:
		*v = nil
		return nil
	case string:
		text = value
	case []byte:
		text = string(value)
	default:
		return fmt.Errorf("vector: cannot scan %T", src)
	}
	parsed, err := ParseVector(text)
	if err != nil {
		return err
	}
	*v = parsed
	return nil
}

// ParseVector reads a one-dimensional Postgres float array literal.
func ParseVector(text string) (Vector, error) {
	text = strings.TrimSpace(text)
	if len(text) < 2 || text[0] != '{' || text[len(text)-1] != '}' {
		return nil, fmt.Errorf("vector: malformed array literal %q", clip(text))
	}
	body := text[1 : len(text)-1]
	if body == "" {
		return Vector{}, nil
	}
	out := make(Vector, 0, strings.Count(body, ",")+1)
	for body != "" {
		item := body
		if i := strings.IndexByte(body, ','); i >= 0 {
			item, body = body[:i], body[i+1:]
		} else {
			body = ""
		}
		item = strings.TrimSpace(item)
		if item == "NULL" {
			out = append(out, 0)
			continue
		}
		f, err := strconv.ParseFloat(item, 32)
		if err != nil {
			return nil, fmt.Errorf("vector: bad element %q", clip(item))
		}
		out = append(out, float32(f))
	}
	return out, nil
}

func clip(s string) string {
	if len(s) > 40 {
		return s[:40] + "…"
	}
	return s
}
