package models

import (
	"math"
	"testing"
)

func TestVectorRoundTrip(t *testing.T) {
	in := Vector{1, -2.5, 0.1, 3.4028235e38, 1e-8, 0}
	raw, err := in.Value()
	if err != nil {
		t.Fatal(err)
	}
	text, ok := raw.(string)
	if !ok || text[0] != '{' || text[len(text)-1] != '}' {
		t.Fatalf("Value() = %#v", raw)
	}
	var out Vector
	if err := out.Scan(text); err != nil {
		t.Fatal(err)
	}
	if len(out) != len(in) {
		t.Fatalf("len = %d, want %d", len(out), len(in))
	}
	for i := range in {
		if out[i] != in[i] {
			t.Fatalf("element %d: %v != %v", i, out[i], in[i])
		}
	}
	var fromBytes Vector
	if err := fromBytes.Scan([]byte("{1.5, 2}")); err != nil || len(fromBytes) != 2 || fromBytes[1] != 2 {
		t.Fatalf("bytes scan: %v %v", fromBytes, err)
	}
}

func TestVectorScanEdgeCases(t *testing.T) {
	var v Vector
	if err := v.Scan(nil); err != nil || v != nil {
		t.Fatalf("nil: %v %v", v, err)
	}
	if err := v.Scan("{}"); err != nil || len(v) != 0 {
		t.Fatalf("empty: %v %v", v, err)
	}
	if err := v.Scan("{1,NULL,3}"); err != nil || len(v) != 3 || v[1] != 0 {
		t.Fatalf("null element: %v %v", v, err)
	}
	if err := v.Scan("[1,2]"); err == nil {
		t.Fatal("expected error for pgvector literal")
	}
	if err := v.Scan("{1,x}"); err == nil {
		t.Fatal("expected error for bad element")
	}
	if err := v.Scan(42); err == nil {
		t.Fatal("expected error for int source")
	}
	if raw, _ := Vector(nil).Value(); raw != nil {
		t.Fatalf("nil Value() = %#v", raw)
	}
	if raw, _ := (Vector{float32(math.Pi)}).Value(); raw != "{3.1415927}" {
		t.Fatalf("pi = %v", raw)
	}
}
