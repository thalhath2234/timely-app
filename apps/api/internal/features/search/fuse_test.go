package search

import (
	"testing"
)

func kw(kind, id, title string, tier int) keywordHit {
	return keywordHit{Hit: Hit{Kind: kind, ID: id, Title: title, Snippet: "kw " + title}, Tier: tier}
}

func sem(kind, id, title string, score float64) Hit {
	return Hit{Kind: kind, ID: id, Title: title, Snippet: "sem " + title, Content: "chunk " + title, Score: score}
}

func ids(hits []Hit) []string {
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		out = append(out, h.ID)
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestFuseItemInBothListsOutranksSingles(t *testing.T) {
	keyword := []keywordHit{kw("task", "a", "A", tierTitleMatch), kw("task", "b", "B", tierBodyMatch)}
	semantic := []Hit{sem("task", "c", "C", 0.9), sem("task", "b", "B", 0.8)}
	got := ids(fuse(keyword, semantic, 10))
	if got[0] != "b" {
		t.Fatalf("expected b (in both lists) first, got %v", got)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 unique hits, got %v", got)
	}
}

func TestFuseExactTitleBeatsTopSemantic(t *testing.T) {
	keyword := []keywordHit{kw("task", "exact", "Pay rent", tierExactTitle)}
	semantic := []Hit{sem("doc", "d1", "Budget notes", 0.95), sem("doc", "d2", "Rent history", 0.9)}
	got := ids(fuse(keyword, semantic, 10))
	if got[0] != "exact" {
		t.Fatalf("expected the exact title match first, got %v", got)
	}
}

func TestFuseWithoutExactBonusTiesBreakByKeywordFirst(t *testing.T) {
	keyword := []keywordHit{kw("task", "k", "K", tierTitleMatch)}
	semantic := []Hit{sem("task", "s", "S", 0.9)}
	got := ids(fuse(keyword, semantic, 10))
	if !equal(got, []string{"k", "s"}) {
		t.Fatalf("expected keyword list to win ties, got %v", got)
	}
}

func TestFusePrefersSemanticSnippetAndContent(t *testing.T) {
	keyword := []keywordHit{kw("doc", "x", "X", tierTitleMatch)}
	semantic := []Hit{sem("doc", "x", "X", 0.7)}
	got := fuse(keyword, semantic, 10)
	if len(got) != 1 {
		t.Fatalf("expected dedupe to one hit, got %d", len(got))
	}
	if got[0].Snippet != "sem X" || got[0].Content != "chunk X" {
		t.Fatalf("expected semantic snippet/content, got %+v", got[0])
	}
	if got[0].Score <= 0 {
		t.Fatalf("expected fused score, got %v", got[0].Score)
	}
}

func TestFuseRespectsLimitAndSameIDAcrossKinds(t *testing.T) {
	keyword := []keywordHit{kw("task", "1", "T", tierTitleMatch), kw("doc", "1", "D", tierTitleMatch)}
	semantic := []Hit{sem("event", "2", "E", 0.5)}
	got := fuse(keyword, semantic, 2)
	if len(got) != 2 {
		t.Fatalf("expected limit 2, got %d", len(got))
	}
	all := fuse(keyword, semantic, 0)
	if len(all) != 3 {
		t.Fatalf("expected the same id under two kinds to stay distinct, got %d", len(all))
	}
}

func TestFuseSemanticOnlyAndKeywordOnly(t *testing.T) {
	if got := ids(fuse(nil, []Hit{sem("task", "a", "A", 1), sem("task", "b", "B", 0.5)}, 10)); !equal(got, []string{"a", "b"}) {
		t.Fatalf("semantic-only order lost: %v", got)
	}
	if got := ids(fuse([]keywordHit{kw("task", "a", "A", 0), kw("task", "b", "B", 0)}, nil, 10)); !equal(got, []string{"a", "b"}) {
		t.Fatalf("keyword-only order lost: %v", got)
	}
}

func TestEscapeLike(t *testing.T) {
	if got := escapeLike(`100% a_b \x`); got != `100\% a\_b \\x` {
		t.Fatalf("got %q", got)
	}
}
