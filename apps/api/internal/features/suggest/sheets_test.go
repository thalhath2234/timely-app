package suggest

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"timely-api/internal/features/decide"
)

func TestColumnCandidates(t *testing.T) {
	cases := []struct {
		values  []string
		types   []string
		options []string
	}{
		{[]string{"12.50", "3", ""}, []string{"number", "currency"}, nil},
		{[]string{"5%", "12.5%"}, []string{"percent"}, nil},
		{[]string{"2026-10-01", "2026-10-09"}, []string{"date"}, nil},
		{[]string{"10/01/2026"}, nil, nil}, // day or month first: never guessed
		{[]string{"yes", "No", "Y"}, []string{"boolean"}, nil},
		{[]string{"1", "0"}, []string{"number", "currency"}, nil},
		{[]string{"Open", "Done", "Open", "Done", "Open"}, []string{"select"}, []string{"Open", "Done"}},
		{[]string{"Alice", "Bob", "Carol"}, nil, nil}, // every value distinct: text
		{[]string{"", " "}, nil, nil},
	}
	for _, c := range cases {
		types, options := candidates(c.values)
		if !reflect.DeepEqual(types, c.types) || !reflect.DeepEqual(options, c.options) {
			t.Errorf("%v: got %v %v, want %v %v", c.values, types, options, c.types, c.options)
		}
	}
}

func TestColumnTypesAskOnlyWhereValuesAllowIt(t *testing.T) {
	var asked map[string]json.RawMessage
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.Unmarshal(body, &req)
		asked = req.Questions
		_ = json.NewEncoder(w).Encode(map[string]any{"answers": map[string]any{
			"c2": map[string]any{"type": "choice", "choice": "currency", "confidence": 0.9},
			"c3": map[string]any{"type": "choice", "choice": "text", "confidence": 0.95},
			"c4": map[string]any{"type": "choice", "choice": "select", "confidence": 0.8},
		}})
	}))
	defer srv.Close()
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	d := decide.New(nil, func(context.Context, string) (decide.Keys, error) {
		return decide.Keys{Enabled: true, TypeSafe: "ts-key"}, nil
	}, client)
	s := New(nil, d, nil)
	out, err := s.ColumnTypes(context.Background(), "u1", []ImportColumn{
		{Name: "Name", Values: []string{"Rent", "Food"}},
		{Name: "Amount", Values: []string{"900", "300.5"}},
		{Name: "Zip", Values: []string{"02139", "10001"}},
		{Name: "Status", Values: []string{"Paid", "Due", "Paid", "Due"}},
	})
	if err != nil || !out.Available {
		t.Fatal(out, err)
	}
	if _, ok := asked["c1"]; ok || len(asked) != 3 {
		t.Fatalf("asked %v", asked)
	}
	if out.Columns[0] != nil || out.Columns[1].Type != "currency" || out.Columns[2] != nil || out.Columns[3].Type != "select" || strings.Join(out.Columns[3].Options, ",") != "Paid,Due" {
		t.Fatalf("%+v", out.Columns)
	}
	off := New(nil, decide.New(nil, func(context.Context, string) (decide.Keys, error) { return decide.Keys{}, nil }, client), nil)
	if out, _ := off.ColumnTypes(context.Background(), "u1", []ImportColumn{{Name: "Amount", Values: []string{"1"}}}); out.Available || out.Columns[0] != nil {
		t.Fatal("suggestions off still typed a column")
	}
}
