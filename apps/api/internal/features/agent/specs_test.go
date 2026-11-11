package agent

import (
	"encoding/json"
	"regexp"
	"sort"
	"testing"
)

func TestChatReadSpecsAreExactlyTheReadTools(t *testing.T) {
	c := NewCatalog(Deps{})
	specs := ChatReadSpecs(c)
	reads := []string{}
	for name, tool := range c {
		if tool.Authority.Access == Read {
			reads = append(reads, name)
		}
	}
	sort.Strings(reads)
	if len(specs) != len(reads) {
		t.Fatalf("got %d specs, catalog has %d Read tools", len(specs), len(reads))
	}
	for i, spec := range specs {
		if spec.Name != reads[i] {
			t.Fatalf("spec %d is %s, want %s (sorted by name)", i, spec.Name, reads[i])
		}
		tool := c[spec.Name]
		if tool.Authority.Access != Read {
			t.Errorf("%s has access %d; only Read tools are specs", spec.Name, tool.Authority.Access)
		}
		if spec.Outside != OutsideTool(spec.Name) {
			t.Errorf("%s outside = %v, want %v", spec.Name, spec.Outside, OutsideTool(spec.Name))
		}
	}
	for _, never := range []string{"create_task", "update_task", "delete_task", "update_working_hours", "export_account", "propose_changes"} {
		for _, spec := range specs {
			if spec.Name == never {
				t.Errorf("%s must not be offered as a spec", never)
			}
		}
	}
}

// The worker must be offered byte-for-byte what the classic engine offers
// (chat/runner.go toolSpec): the same name, description and parameters.
func TestChatReadSpecsMatchTheClassicOffer(t *testing.T) {
	c := NewCatalog(Deps{})
	for _, spec := range ChatReadSpecs(c) {
		tool := c[spec.Name]
		classic, _ := json.Marshal(map[string]any{"name": spec.Name, "description": tool.Description, "parameters": tool.Parameters})
		got, _ := json.Marshal(map[string]any{"name": spec.Name, "description": spec.Description, "parameters": spec.Parameters})
		if string(classic) != string(got) {
			t.Errorf("%s spec differs from the classic offer:\n got %s\nwant %s", spec.Name, got, classic)
		}
	}
}

func TestSpecsJSONHasTheProtocolShape(t *testing.T) {
	specs := ChatReadSpecs(NewCatalog(Deps{}))
	raw, err := json.Marshal(specs[0])
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"name", "description", "parameters", "outside"} {
		if _, ok := fields[key]; !ok {
			t.Errorf("spec JSON lacks %q: %s", key, raw)
		}
	}
	if len(fields) != 4 {
		t.Errorf("spec JSON has extra keys: %s", raw)
	}
}

func TestSpecsVersionIsStableAndChangesWithTheSpecs(t *testing.T) {
	a := SpecsVersion(ChatReadSpecs(NewCatalog(Deps{})))
	b := SpecsVersion(ChatReadSpecs(NewCatalog(Deps{})))
	if a != b {
		t.Fatalf("two builds of the same catalog hash differently: %s vs %s", a, b)
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(a) {
		t.Fatalf("version %q is not a sha256 hex digest", a)
	}
	specs := ChatReadSpecs(NewCatalog(Deps{}))
	specs[0].Description += " (changed)"
	if SpecsVersion(specs) == a {
		t.Fatal("a changed description kept the version")
	}
	specs = ChatReadSpecs(NewCatalog(Deps{}))
	specs[0].Outside = !specs[0].Outside
	if SpecsVersion(specs) == a {
		t.Fatal("a changed outside flag kept the version")
	}
}

func TestSpecsVersionIgnoresKeyOrder(t *testing.T) {
	one := []ToolSpec{{Name: "x", Parameters: map[string]any{"type": "object", "properties": map[string]any{"a": 1, "b": 2}}}}
	// The same parameters arriving as raw JSON in another key order.
	two := []ToolSpec{{Name: "x", Parameters: json.RawMessage(`{"properties":{"b":2,"a":1},"type":"object"}`)}}
	if SpecsVersion(one) != SpecsVersion(two) {
		t.Fatal("key order changed the version")
	}
}
