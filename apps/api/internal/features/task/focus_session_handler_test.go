package task

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
)

type focusSessionLister struct {
	TaskService
	calls int
}

func (f *focusSessionLister) ListFocusSessions(string, time.Time, time.Time) ([]models.FocusSession, error) {
	f.calls++
	return []models.FocusSession{}, nil
}

func focusSessionsStatus(t *testing.T, svc TaskService, query url.Values) int {
	t.Helper()
	c := echo.New().NewContext(httptest.NewRequest(http.MethodGet, "/tasks/focus-sessions?"+query.Encode(), nil), httptest.NewRecorder())
	c.Set("userID", "usr_focus")
	err := NewHandler(svc).ListFocusSessions(c)
	if err == nil {
		return http.StatusOK
	}
	he, ok := err.(*echo.HTTPError)
	if !ok {
		t.Fatalf("error = %v, want an HTTP error", err)
	}
	return he.Code
}

func TestFocusSessionsEndpointValidatesItsQuery(t *testing.T) {
	from := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	span := func(d time.Duration) url.Values {
		return url.Values{"from": {from.Format(time.RFC3339)}, "to": {from.Add(d).Format(time.RFC3339)}}
	}
	day := 24 * time.Hour
	cases := []struct {
		name  string
		query url.Values
		want  int
	}{
		{"a week", span(7 * day), http.StatusOK},
		{"400 days", span(400 * day), http.StatusOK},
		{"fractional seconds", url.Values{"from": {"2026-10-01T00:00:00.000Z"}, "to": {"2026-10-08T00:00:00.000Z"}}, http.StatusOK},
		{"offset", url.Values{"from": {"2026-10-01T00:00:00+05:30"}, "to": {"2026-10-02T00:00:00+05:30"}}, http.StatusOK},
		{"missing from", url.Values{"to": {from.Format(time.RFC3339)}}, http.StatusBadRequest},
		{"missing to", url.Values{"from": {from.Format(time.RFC3339)}}, http.StatusBadRequest},
		{"date only", url.Values{"from": {"2026-10-01"}, "to": {"2026-10-08"}}, http.StatusBadRequest},
		{"garbage", url.Values{"from": {"yesterday"}, "to": {"today"}}, http.StatusBadRequest},
		{"empty range", span(0), http.StatusBadRequest},
		{"reversed", span(-day), http.StatusBadRequest},
		{"over 400 days", span(400*day + time.Second), http.StatusBadRequest},
	}
	for _, tc := range cases {
		svc := &focusSessionLister{}
		if got := focusSessionsStatus(t, svc, tc.query); got != tc.want {
			t.Errorf("%s: status %d, want %d", tc.name, got, tc.want)
		}
		if tc.want != http.StatusOK && svc.calls != 0 {
			t.Errorf("%s: service called on a bad query", tc.name)
		}
	}
}

func TestFocusSessionsEndpointNeedsAUser(t *testing.T) {
	c := echo.New().NewContext(httptest.NewRequest(http.MethodGet, "/tasks/focus-sessions", nil), httptest.NewRecorder())
	err := NewHandler(&focusSessionLister{}).ListFocusSessions(c)
	if he, ok := err.(*echo.HTTPError); !ok || he.Code != http.StatusUnauthorized {
		t.Fatalf("error = %v, want 401", err)
	}
}
