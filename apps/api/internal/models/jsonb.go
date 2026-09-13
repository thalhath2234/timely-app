package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"gorm.io/gorm"
)

var identRE = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// EncodeJSONB turns a Go value into JSON text for a `?::jsonb` bind.
func EncodeJSONB(value any) (string, error) {
	switch v := value.(type) {
	case nil:
		return "null", nil
	case []byte:
		if len(v) == 0 {
			return "null", nil
		}
		return string(v), nil
	case string:
		if v == "" {
			return "null", nil
		}
		return v, nil
	case JSONMap:
		b, err := MarshalJSONMap(v)
		return string(b), err
	case driver.Valuer:
		raw, err := v.Value()
		if err != nil {
			return "", err
		}
		return EncodeJSONB(raw)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
}

// WriteJSONB updates jsonb columns with a raw `col = ?::jsonb` assignment so
// GORM Updates(map) cannot silently drop map/slice values.
func WriteJSONB(db *gorm.DB, table string, columns map[string]any, where string, args ...any) error {
	if len(columns) == 0 {
		return nil
	}
	if !identRE.MatchString(table) {
		return fmt.Errorf("invalid table name %q", table)
	}

	keys := make([]string, 0, len(columns))
	for key := range columns {
		if !identRE.MatchString(key) {
			return fmt.Errorf("invalid column name %q", key)
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)

	sets := make([]string, 0, len(keys))
	vars := make([]any, 0, len(keys)+len(args))
	for _, key := range keys {
		encoded, err := EncodeJSONB(columns[key])
		if err != nil {
			return err
		}
		sets = append(sets, key+" = ?::jsonb")
		vars = append(vars, encoded)
	}
	vars = append(vars, args...)
	sql := fmt.Sprintf("UPDATE %s SET %s WHERE %s", table, strings.Join(sets, ", "), where)
	return db.Exec(sql, vars...).Error
}
