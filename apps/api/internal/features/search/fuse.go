package search

import (
	"sort"
	"strings"
)

// rrfK is the smoothing constant from the reciprocal rank fusion paper
// (Cormack et al. 2009). 60 keeps a #1 hit in one list from drowning out an
// item that is #2 in both.
const rrfK = 60.0

// exactTitleBonus is added when the keyword tier says the title matches the
// query exactly. It equals a #1 position in a third list, so typing a task's
// full name lands that task on top even when the embedding missed it.
const exactTitleBonus = 1.0 / (rrfK + 1)

// fuse merges a keyword-ranked list and a vector-ranked list with reciprocal
// rank fusion. Each entity contributes 1/(k + rank) per list it appears in.
// Fields from the semantic hit win where both lists carry the entity because
// its content is the chunk nearest the query, not the record's first bytes.
func fuse(keyword []keywordHit, semantic []Hit, limit int) []Hit {
	type entry struct {
		hit   Hit
		score float64
		order int
	}
	entries := map[string]*entry{}
	next := 0
	get := func(hit Hit) *entry {
		key := hit.Kind + ":" + hit.ID
		e, ok := entries[key]
		if !ok {
			e = &entry{hit: hit, order: next}
			next++
			entries[key] = e
		}
		return e
	}

	for rank, kw := range keyword {
		e := get(kw.Hit)
		e.score += 1 / (rrfK + float64(rank+1))
		if kw.Tier == tierExactTitle {
			e.score += exactTitleBonus
		}
	}
	for rank, hit := range semantic {
		e := get(hit)
		e.score += 1 / (rrfK + float64(rank+1))
		// Prefer the semantic chunk's snippet and content.
		e.hit.Snippet = hit.Snippet
		e.hit.Content = hit.Content
		if e.hit.Title == "" {
			e.hit.Title = hit.Title
		}
	}

	out := make([]*entry, 0, len(entries))
	for _, e := range entries {
		out = append(out, e)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].score != out[j].score {
			return out[i].score > out[j].score
		}
		return out[i].order < out[j].order
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	hits := make([]Hit, 0, len(out))
	for _, e := range out {
		e.hit.Score = e.score
		hits = append(hits, e.hit)
	}
	return hits
}

// Keyword tiers, highest first. The SQL CASE in service.go must agree.
const (
	tierExactTitle  = 3
	tierTitlePrefix = 2
	tierTitleMatch  = 1
	tierBodyMatch   = 0
)

type keywordHit struct {
	Hit
	Tier int
}

// escapeLike makes a user string safe inside an ILIKE pattern so "100%" or
// "a_b" match literally. Postgres uses backslash as the default escape.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}
