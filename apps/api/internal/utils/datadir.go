package utils

import (
	"os"
	"path/filepath"
	"strings"
)

// DataDir is TIMELY_DATA_DIR: the directory that roots every file the API
// writes (backups, chat images) when it hosts a packaged install. Empty when
// unset, in which case each feature keeps its historical default.
func DataDir() string {
	return strings.TrimSpace(os.Getenv("TIMELY_DATA_DIR"))
}

// ResolveDataPath picks the directory for one kind of file. The env var wins
// when set; a relative value resolves under DataDir when that is set and
// under the working directory otherwise. With the env var unset the path is
// <DataDir>/<defaultRelative>, or fallback when DataDir is unset too.
func ResolveDataPath(envVar, defaultRelative, fallback string) string {
	root := DataDir()
	if value := strings.TrimSpace(os.Getenv(envVar)); value != "" {
		if filepath.IsAbs(value) || root == "" {
			return value
		}
		return filepath.Join(root, value)
	}
	if root != "" {
		return filepath.Join(root, defaultRelative)
	}
	if fallback == "" {
		return defaultRelative
	}
	return fallback
}

// EnsureDir creates dir (and parents) readable by the API's user only.
func EnsureDir(dir string) error {
	return os.MkdirAll(dir, 0o700)
}
