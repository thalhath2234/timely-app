package agenthost

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

// defaultStaleGrace is Config.StaleGrace's default.
const defaultStaleGrace = 2 * time.Second

// errBadTools is a Config.TimelyTools answer that is not a JSON array.
var errBadTools = errors.New("Timely tool specs are not a JSON array")

// catalog is the tool catalog a new worker gets in hello: Config.TimelyTools
// when set (its version, and the tools as hello.timely_tools), else
// Config.CatalogVersion and no Timely tools.
func (s *Supervisor) catalog(ctx context.Context) (string, *timelyTools, error) {
	if s.cfg.TimelyTools == nil {
		return s.cfg.CatalogVersion, nil, nil
	}
	version, raw, err := s.cfg.TimelyTools(ctx)
	if err != nil {
		return "", nil, err
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		raw = json.RawMessage("[]")
	}
	if raw[0] != '[' || !json.Valid(raw) {
		return "", nil, errBadTools
	}
	if version == "" {
		version = toolsVersion(raw)
	}
	return version, &timelyTools{CatalogVersion: version, Tools: raw}, nil
}

// currentCatalog is the catalog version a worker started now would get, for
// the stale check in Ensure. ok is false when there is nothing to compare
// (no Config.TimelyTools) or the catalog cannot be read; a worker is then
// never restarted for its catalog.
func (s *Supervisor) currentCatalog(ctx context.Context) (string, bool) {
	if s.cfg.TimelyTools == nil {
		return "", false
	}
	version, _, err := s.catalog(ctx)
	if err != nil {
		s.logf("agent: reading the Timely tool specs: %v (workers keep the catalog they started with)", err)
		return "", false
	}
	return version, true
}

// toolsVersion is the sha256 of the compacted tools JSON, used when
// Config.TimelyTools gives no version of its own.
func toolsVersion(raw json.RawMessage) string {
	var buf bytes.Buffer
	if json.Compact(&buf, raw) != nil {
		buf.Reset()
		buf.Write(raw)
	}
	sum := sha256.Sum256(buf.Bytes())
	return hex.EncodeToString(sum[:])
}
