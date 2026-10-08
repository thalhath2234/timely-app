package agent

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"timely-api/internal/features/doc"
	"timely-api/internal/richtext"
)

// add_3d_model builds an ASCII STL from simple solids so the assistant never
// writes triangles by hand. Each part becomes its own `solid <name> #color`
// block; the doc viewer colors parts from that name and other STL readers
// ignore it, so the .md file stays a plain ```stl block.

const (
	maxModelParts     = 40
	defaultSegments   = 10
	minSegments       = 6
	maxSegments       = 24
	maxModelDimension = 100000
	// About 500 KB of STL. Bigger models make the doc slow to load and edit,
	// so curved parts get coarser before a model is refused.
	maxModelTriangles = 4000
)

type modelPartIn struct {
	Name     string    `json:"name,omitempty" jsonschema:"short part name, e.g. head"`
	Shape    string    `json:"shape" jsonschema:"sphere, box, cylinder, cone or capsule"`
	Center   []float64 `json:"center" jsonschema:"[x, y, z] of the part's middle; z is up"`
	Size     []float64 `json:"size" jsonschema:"sphere: [rx, ry, rz] radii (unequal radii make an ellipsoid); box: [width, depth, height]; cylinder, cone, capsule: [rx, ry, height] with the axis along z before rotation"`
	Rotation []float64 `json:"rotation,omitempty" jsonschema:"optional [x, y, z] degrees, applied x then y then z around the center"`
	Color    string    `json:"color,omitempty" jsonschema:"#rrggbb or #rgb"`
}

type add3DModelIn struct {
	DocID    string        `json:"docId"`
	Name     string        `json:"name,omitempty" jsonschema:"model name, used for parts without one"`
	Parts    []modelPartIn `json:"parts"`
	Segments int           `json:"segments,omitempty" jsonschema:"roundness of curved parts, 6-24, default 10"`
	Replace  bool          `json:"replace,omitempty" jsonschema:"true replaces the doc's first stl block instead of appending"`
}

var (
	hexColorRe  = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)
	stlFenceRe  = regexp.MustCompile("(?ms)^```+stl[ \t]*\n.*?\n```+[ \t]*$")
	partNameBad = regexp.MustCompile(`[^A-Za-z0-9_-]+`)
)

func (s *Server) add3DModel(ctx context.Context, req *mcp.CallToolRequest, in add3DModelIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	stl, facets, err := buildSTL(in)
	if err != nil {
		return fail(err)
	}
	current, err := s.Docs.GetByID(uid, in.DocID)
	if err != nil {
		return fail(err)
	}
	block := "```stl\n" + stl + "```"
	markdown := richtext.ToMarkdown(current.Content)
	verb := "added"
	if loc := stlFenceRe.FindStringIndex(markdown); in.Replace && loc != nil {
		markdown = markdown[:loc[0]] + block + markdown[loc[1]:]
		verb = "replaced"
	} else {
		if markdown != "" {
			markdown += "\n\n"
		}
		markdown += block
	}
	rich, plain := md(markdown)
	d, err := s.Docs.Update(uid, in.DocID, doc.DocumentUpdate{Content: &rich, PlainText: &plain})
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%s a 3D model (%d parts, %d triangles) in %s", verb, len(in.Parts), facets, d.Title), docPayload(d))
}

type vec3 [3]float64

func (a vec3) sub(b vec3) vec3 { return vec3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func (a vec3) cross(b vec3) vec3 {
	return vec3{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}
func (a vec3) length() float64 { return math.Sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]) }

// buildSTL returns the ASCII STL for the parts and how many triangles it has.
func buildSTL(in add3DModelIn) (string, int, error) {
	if len(in.Parts) == 0 {
		return "", 0, fmt.Errorf("parts is empty")
	}
	if len(in.Parts) > maxModelParts {
		return "", 0, fmt.Errorf("at most %d parts", maxModelParts)
	}
	segments := in.Segments
	if segments == 0 {
		segments = defaultSegments
	}
	segments = min(max(segments, minSegments), maxSegments)
	meshes, total, err := partMeshes(in.Parts, segments)
	for err == nil && total > maxModelTriangles && segments > minSegments {
		segments = max(segments-2, minSegments)
		meshes, total, err = partMeshes(in.Parts, segments)
	}
	if err != nil {
		return "", 0, err
	}
	if total > maxModelTriangles {
		return "", 0, fmt.Errorf("model needs %d triangles, the limit is %d: use fewer parts", total, maxModelTriangles)
	}
	fallback := cleanPartName(in.Name)
	if fallback == "" {
		fallback = "part"
	}
	var out strings.Builder
	for i, part := range in.Parts {
		name := cleanPartName(part.Name)
		if name == "" {
			name = fmt.Sprintf("%s_%d", fallback, i+1)
		}
		head := name
		if part.Color != "" {
			if !hexColorRe.MatchString(part.Color) {
				return "", 0, fmt.Errorf("part %d: color must be #rrggbb or #rgb", i+1)
			}
			head += " " + strings.ToLower(part.Color)
		}
		out.WriteString("solid " + head + "\n")
		for _, t := range meshes[i] {
			n := t[1].sub(t[0]).cross(t[2].sub(t[0]))
			if l := n.length(); l > 0 {
				n = vec3{n[0] / l, n[1] / l, n[2] / l}
			}
			out.WriteString("facet normal " + fmtVec(n, 4) + "\nouter loop\n")
			for _, v := range t {
				out.WriteString("vertex " + fmtVec(v, 3) + "\n")
			}
			out.WriteString("endloop\nendfacet\n")
		}
		out.WriteString("endsolid " + name + "\n")
	}
	return out.String(), total, nil
}

func partMeshes(parts []modelPartIn, segments int) ([][][3]vec3, int, error) {
	meshes := make([][][3]vec3, len(parts))
	total := 0
	for i, part := range parts {
		tris, err := partTriangles(part, segments)
		if err != nil {
			return nil, 0, fmt.Errorf("part %d: %w", i+1, err)
		}
		meshes[i] = tris
		total += len(tris)
	}
	return meshes, total, nil
}

func cleanPartName(name string) string {
	return strings.Trim(partNameBad.ReplaceAllString(strings.TrimSpace(name), "_"), "_")
}

func fmtVec(v vec3, digits int) string {
	parts := make([]string, 3)
	for i, x := range v {
		x = math.Round(x*math.Pow10(digits)) / math.Pow10(digits)
		if x == 0 {
			x = 0 // drops -0
		}
		parts[i] = strconv.FormatFloat(x, 'f', -1, 64)
	}
	return strings.Join(parts, " ")
}

func triple(name string, v []float64, positive bool) (vec3, error) {
	if len(v) != 3 {
		return vec3{}, fmt.Errorf("%s needs three numbers", name)
	}
	var out vec3
	for i, x := range v {
		if math.IsNaN(x) || math.IsInf(x, 0) || math.Abs(x) > maxModelDimension {
			return vec3{}, fmt.Errorf("%s has an invalid number", name)
		}
		if positive && x <= 0 {
			return vec3{}, fmt.Errorf("%s must be greater than zero", name)
		}
		out[i] = x
	}
	return out, nil
}

func partTriangles(part modelPartIn, segments int) ([][3]vec3, error) {
	center, err := triple("center", part.Center, false)
	if err != nil {
		return nil, err
	}
	size, err := triple("size", part.Size, true)
	if err != nil {
		return nil, err
	}
	rotation := vec3{}
	if len(part.Rotation) > 0 {
		if rotation, err = triple("rotation", part.Rotation, false); err != nil {
			return nil, err
		}
	}
	var tris [][3]vec3
	switch strings.ToLower(strings.TrimSpace(part.Shape)) {
	case "box", "cube":
		tris = boxTriangles(size)
	case "sphere", "ellipsoid":
		var profile [][2]float64 // (radius factor, z)
		rings := max(segments/2, 3)
		for i := 0; i <= rings; i++ {
			a := math.Pi * float64(i) / float64(rings)
			profile = append(profile, [2]float64{math.Sin(a), -size[2] * math.Cos(a)})
		}
		tris = lathe(profile, size, segments)
	case "cylinder":
		h := size[2] / 2
		tris = lathe([][2]float64{{0, -h}, {1, -h}, {1, h}, {0, h}}, size, segments)
	case "cone":
		h := size[2] / 2
		tris = lathe([][2]float64{{0, -h}, {1, -h}, {0, h}}, size, segments)
	case "capsule":
		// Rounded ends use the smaller radius so a short capsule stays a pill.
		r := math.Min(size[0], size[1])
		h := size[2] / 2
		end := math.Min(r, h)
		var profile [][2]float64
		steps := max(segments/4, 2)
		for i := 0; i <= steps; i++ {
			a := math.Pi / 2 * float64(i) / float64(steps)
			profile = append(profile, [2]float64{math.Sin(a), -h + end*(1-math.Cos(a))})
		}
		for i := 0; i <= steps; i++ {
			a := math.Pi / 2 * float64(i) / float64(steps)
			profile = append(profile, [2]float64{math.Cos(a), h - end*(1-math.Sin(a))})
		}
		tris = lathe(profile, size, segments)
	default:
		return nil, fmt.Errorf("shape %q is not one of sphere, box, cylinder, cone, capsule", part.Shape)
	}
	rotate := rotationMatrix(rotation)
	for i := range tris {
		for j := range tris[i] {
			v := rotate(tris[i][j])
			tris[i][j] = vec3{v[0] + center[0], v[1] + center[1], v[2] + center[2]}
		}
	}
	return tris, nil
}

// lathe turns a profile of (radius factor, z) points, listed bottom to top,
// around the z axis. Radius factors scale by size[0] along x and size[1]
// along y, so circles can be ellipses. Triangles wind outward.
func lathe(profile [][2]float64, size vec3, segments int) [][3]vec3 {
	at := func(p [2]float64, j int) vec3 {
		a := 2 * math.Pi * float64(j%segments) / float64(segments)
		return vec3{p[0] * size[0] * math.Cos(a), p[0] * size[1] * math.Sin(a), p[1]}
	}
	var tris [][3]vec3
	add := func(a, b, c vec3) {
		if b.sub(a).cross(c.sub(a)).length() > 1e-12 {
			tris = append(tris, [3]vec3{a, b, c})
		}
	}
	for i := 0; i+1 < len(profile); i++ {
		for j := 0; j < segments; j++ {
			a, b := at(profile[i], j), at(profile[i], j+1)
			c, d := at(profile[i+1], j+1), at(profile[i+1], j)
			add(a, b, c)
			add(a, c, d)
		}
	}
	return tris
}

func boxTriangles(size vec3) [][3]vec3 {
	x, y, z := size[0]/2, size[1]/2, size[2]/2
	c := [8]vec3{{-x, -y, -z}, {x, -y, -z}, {x, y, -z}, {-x, y, -z}, {-x, -y, z}, {x, -y, z}, {x, y, z}, {-x, y, z}}
	faces := [6][4]int{{0, 3, 2, 1}, {4, 5, 6, 7}, {0, 1, 5, 4}, {1, 2, 6, 5}, {2, 3, 7, 6}, {3, 0, 4, 7}}
	tris := make([][3]vec3, 0, 12)
	for _, f := range faces {
		tris = append(tris, [3]vec3{c[f[0]], c[f[1]], c[f[2]]}, [3]vec3{c[f[0]], c[f[2]], c[f[3]]})
	}
	return tris
}

// rotationMatrix rotates around x, then y, then z (degrees).
func rotationMatrix(deg vec3) func(vec3) vec3 {
	sx, cx := math.Sincos(deg[0] * math.Pi / 180)
	sy, cy := math.Sincos(deg[1] * math.Pi / 180)
	sz, cz := math.Sincos(deg[2] * math.Pi / 180)
	return func(v vec3) vec3 {
		v = vec3{v[0], v[1]*cx - v[2]*sx, v[1]*sx + v[2]*cx}
		v = vec3{v[0]*cy + v[2]*sy, v[1], -v[0]*sy + v[2]*cy}
		return vec3{v[0]*cz - v[1]*sz, v[0]*sz + v[1]*cz, v[2]}
	}
}
