package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// fakeEmbeddings answers OpenRouter's embeddings call with one vector per
// input and keeps the inputs it was sent.
type fakeEmbeddings struct{ inputs []string }

func (f *fakeEmbeddings) RoundTrip(r *http.Request) (*http.Response, error) {
	var req embedRequest
	raw, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(raw, &req)
	f.inputs = append(f.inputs, req.Input...)
	type row struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	}
	out := struct {
		Data []row `json:"data"`
	}{}
	for n := range req.Input {
		vec := make([]float32, vectorDims)
		vec[0] = 1
		out.Data = append(out.Data, row{Embedding: vec, Index: n})
	}
	body, _ := json.Marshal(out)
	return &http.Response{StatusCode: 200, Status: "200 OK", Body: io.NopCloser(bytes.NewReader(body)), Header: http.Header{}}, nil
}

// queryIndexer is an indexer whose account holds count items, each one chunk.
func queryIndexer(fake *fakeEmbeddings, count int) *indexer {
	i := &indexer{http: &http.Client{Transport: fake}, model: defaultModel}
	i.resolve = func(string) (string, string) { return "sk-or-test", defaultModel }
	i.vectors = newVectorCache(time.Minute, func(context.Context, string) ([]cachedChunk, error) {
		chunks := make([]cachedChunk, count)
		for n := range chunks {
			vec := make([]float32, vectorDims)
			vec[0], vec[1] = 1, float32(n)/float32(count)
			chunks[n] = cachedChunk{kind: KindTask, entityID: fmt.Sprintf("t%d", n), title: "Task", content: "words", vec: vec}
		}
		return chunks, nil
	})
	return i
}

// A pasted page used to be embedded whole (about 7,500 tokens per search).
func TestQueryEmbedsAClippedQuery(t *testing.T) {
	fake := &fakeEmbeddings{}
	i := queryIndexer(fake, 3)
	long := strings.Repeat("vehicle service ", 2000)
	if _, err := i.Query(context.Background(), "u1", long, 10, nil); err != nil {
		t.Fatal(err)
	}
	if len(fake.inputs) != 1 {
		t.Fatalf("want one embedding input, got %d", len(fake.inputs))
	}
	if n := utf8.RuneCountInString(fake.inputs[0]); n > maxQueryRunes {
		t.Fatalf("the query was embedded with %d characters; want at most %d", n, maxQueryRunes)
	}
	if !strings.HasPrefix(long, fake.inputs[0]) {
		t.Fatal("the clipped query must be the start of what was searched")
	}
}

// Hybrid search asks for twice its limit: limit 40 asked for 80, which was
// reset to 20, so semantic_search(limit 40) found at most 20 items.
func TestQueryKeepsALargeLimit(t *testing.T) {
	i := queryIndexer(&fakeEmbeddings{}, 120)
	hits, err := i.Query(context.Background(), "u1", "qqzzvv", 80, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 80 {
		t.Fatalf("got %d hits for limit 80; want 80", len(hits))
	}
	hits, err = i.Query(context.Background(), "u1", "qqzzvv", 500, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != maxQueryHits {
		t.Fatalf("got %d hits for limit 500; want the cap, %d", len(hits), maxQueryHits)
	}
}
