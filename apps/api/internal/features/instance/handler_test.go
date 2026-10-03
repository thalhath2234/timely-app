package instance

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v5"
)

func TestInstanceShape(t *testing.T) {
	h := NewHandler(Config{
		Port: 48080, Bind: []string{"127.0.0.1"}, DataDir: "/d", BackupDir: "/d/backups",
		AllowRegistration: false, LocalCLI: true,
		RegistrationOpen: func() bool { return true },
	}, nil)
	h.SetListening([]string{"127.0.0.1:48080"})
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/instance", nil)
	rec := httptest.NewRecorder()
	if err := h.Instance(e.NewContext(req, rec)); err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"version", "platform", "startedAt", "port", "bind", "listening", "dataDir", "backupDir", "allowRegistration", "registrationOpen", "localCli"} {
		if _, ok := out[key]; !ok {
			t.Fatalf("missing %s in %s", key, rec.Body.String())
		}
	}
	if out["port"].(float64) != 48080 || out["allowRegistration"] != false || out["registrationOpen"] != true || out["localCli"] != true {
		t.Fatalf("unexpected values: %s", rec.Body.String())
	}
	if got := out["listening"].([]any); len(got) != 1 || got[0] != "127.0.0.1:48080" {
		t.Fatalf("listening = %v", got)
	}
}

func TestHealthWithoutDatabaseIsDegraded(t *testing.T) {
	h := NewHandler(Config{AllowRegistration: true}, nil)
	e := echo.New()
	rec := httptest.NewRecorder()
	if err := h.Health(e.NewContext(httptest.NewRequest(http.MethodGet, "/health", nil), rec)); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["status"] != "degraded" || out["registrationOpen"] != true {
		t.Fatalf("body = %s", rec.Body.String())
	}
	for _, key := range []string{"status", "version", "db", "migrations", "registrationOpen", "uptimeSeconds"} {
		if _, ok := out[key]; !ok {
			t.Fatalf("missing %s", key)
		}
	}
}
