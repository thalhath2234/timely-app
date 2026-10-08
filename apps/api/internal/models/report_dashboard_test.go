package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReportDashboardValidate(t *testing.T) {
	valid := ReportDashboard(`{"version":1,"cards":[{"id":"a","type":"pomodoro","w":4,"h":3},{"id":"b"}]}`)
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid layout rejected: %v", err)
	}
	if err := ReportDashboard(nil).Validate(); err != nil {
		t.Fatalf("empty layout rejected: %v", err)
	}
	for name, raw := range map[string]string{
		"not an object": `[1,2]`,
		"no cards":      `{"version":1}`,
		"missing id":    `{"cards":[{"type":"notes"}]}`,
		"duplicate id":  `{"cards":[{"id":"a"},{"id":"a"}]}`,
		"numeric id":    `{"cards":[{"id":3}]}`,
	} {
		if err := ReportDashboard(raw).Validate(); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	many := make([]string, MaxReportDashboardCards+1)
	for i := range many {
		many[i] = `{"id":"c` + strings.Repeat("x", i%5) + string(rune('a'+i%26)) + `-` + strings.Repeat("y", i) + `"}`
	}
	if err := ReportDashboard(`{"cards":[` + strings.Join(many, ",") + `]}`).Validate(); err == nil {
		t.Error("expected too many cards")
	}
}

func TestReportDashboardJSON(t *testing.T) {
	var body struct {
		Dashboard *ReportDashboard `json:"reportDashboard"`
	}
	if err := json.Unmarshal([]byte(`{"reportDashboard":{"cards":[]}}`), &body); err != nil {
		t.Fatal(err)
	}
	if body.Dashboard == nil || string(*body.Dashboard) != `{"cards":[]}` {
		t.Fatalf("dashboard = %v", body.Dashboard)
	}
	out, err := json.Marshal(struct {
		Dashboard ReportDashboard `json:"reportDashboard"`
	}{})
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"reportDashboard":null}` {
		t.Fatalf("empty dashboard marshals as %s", out)
	}
}
