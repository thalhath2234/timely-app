package agent

import (
	"math"
	"strings"
	"testing"
)

func TestPartTrianglesAreClosedAndFaceOutward(t *testing.T) {
	cases := []modelPartIn{
		{Shape: "sphere", Center: []float64{1, 2, 3}, Size: []float64{2, 3, 4}},
		{Shape: "box", Center: []float64{0, 0, 0}, Size: []float64{1, 2, 3}, Rotation: []float64{30, 45, 60}},
		{Shape: "cylinder", Center: []float64{0, 0, 5}, Size: []float64{1, 1, 4}, Rotation: []float64{90, 0, 0}},
		{Shape: "cone", Center: []float64{0, 0, 0}, Size: []float64{2, 1, 3}},
		{Shape: "capsule", Center: []float64{-3, 0, 0}, Size: []float64{1, 1, 6}, Rotation: []float64{0, 20, 0}},
		{Shape: "capsule", Center: []float64{0, 0, 0}, Size: []float64{2, 2, 2}},
	}
	for _, part := range cases {
		tris, err := partTriangles(part, 12)
		if err != nil {
			t.Fatalf("%s: %v", part.Shape, err)
		}
		// Every directed edge must meet its reverse exactly once: closed and
		// consistently wound.
		key := func(a, b vec3) string { return fmtVec(a, 6) + "|" + fmtVec(b, 6) }
		edges := map[string]int{}
		volume := 0.0
		for _, tr := range tris {
			for i := range 3 {
				edges[key(tr[i], tr[(i+1)%3])]++
			}
			c := tr[0].cross(tr[1])
			volume += c[0]*tr[2][0] + c[1]*tr[2][1] + c[2]*tr[2][2]
		}
		for e, n := range edges {
			parts := strings.Split(e, "|")
			if n != 1 || edges[parts[1]+"|"+parts[0]] != 1 {
				t.Fatalf("%s: edge %s used %d times, reverse %d", part.Shape, e, n, edges[parts[1]+"|"+parts[0]])
			}
		}
		if volume <= 0 {
			t.Fatalf("%s: triangles face inward (volume %v)", part.Shape, volume/6)
		}
	}
}

func TestBuildSTLNamesAndColorsParts(t *testing.T) {
	stl, facets, err := buildSTL(add3DModelIn{Name: "baby doll", Parts: []modelPartIn{
		{Name: "head", Shape: "sphere", Center: []float64{0, 0, 60}, Size: []float64{12, 12, 13}, Color: "#F2C6A0"},
		{Shape: "capsule", Center: []float64{0, 0, 35}, Size: []float64{11, 9, 26}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"solid head #f2c6a0\n", "endsolid head\n", "solid baby_doll_2\n", "endsolid baby_doll_2\n"} {
		if !strings.Contains(stl, want) {
			t.Fatalf("missing %q", want)
		}
	}
	if got := strings.Count(stl, "endfacet"); got != facets || facets < 100 {
		t.Fatalf("facets %d, endfacet lines %d", facets, got)
	}
	if strings.Contains(stl, "-0 ") || strings.Contains(stl, "NaN") {
		t.Fatal("bad number formatting")
	}
}

func TestBuildSTLRejectsBadInput(t *testing.T) {
	bad := []modelPartIn{
		{Shape: "pyramid", Center: []float64{0, 0, 0}, Size: []float64{1, 1, 1}},
		{Shape: "box", Center: []float64{0, 0}, Size: []float64{1, 1, 1}},
		{Shape: "box", Center: []float64{0, 0, 0}, Size: []float64{1, 0, 1}},
		{Shape: "box", Center: []float64{0, 0, 0}, Size: []float64{1, 1, 1}, Color: "skin"},
		{Shape: "box", Center: []float64{0, 0, math.Inf(1)}, Size: []float64{1, 1, 1}},
	}
	for i, part := range bad {
		if _, _, err := buildSTL(add3DModelIn{Parts: []modelPartIn{part}}); err == nil {
			t.Fatalf("case %d accepted", i)
		}
	}
	many := make([]modelPartIn, maxModelParts+1)
	if _, _, err := buildSTL(add3DModelIn{Parts: many}); err == nil {
		t.Fatal("too many parts accepted")
	}
}

func TestStlFenceFindsFirstBlock(t *testing.T) {
	markdown := "# Baby\n\n```stl\nsolid a\nendsolid a\n```\n\ntext\n\n```stl\nsolid b\nendsolid b\n```"
	loc := stlFenceRe.FindStringIndex(markdown)
	if loc == nil || markdown[loc[0]:loc[1]] != "```stl\nsolid a\nendsolid a\n```" {
		t.Fatalf("got %v", loc)
	}
}
