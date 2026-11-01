package embed

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// answer is an OpenRouter stand-in that gives one fixed response.
type answer struct {
	status int
	body   string
}

func (a answer) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: a.status,
		Status:     fmt.Sprintf("%d %s", a.status, http.StatusText(a.status)),
		Body:       io.NopCloser(strings.NewReader(a.body)),
	}, nil
}

func embedOnce(t *testing.T, a answer) error {
	t.Helper()
	_, err := embedWith(context.Background(), &http.Client{Transport: a}, "key", "model", []string{"text"})
	if err == nil {
		t.Fatalf("status %d was taken for vectors", a.status)
	}
	return err
}

// GB3 and GB31: a refused key or no credits was tried eight times (and eight
// more on Retry), and the saved error was the provider's whole body, with
// the key it quoted, markup and kilobytes of text.
func TestProviderErrorsAreSortedAndShortened(t *testing.T) {
	long := `{"error":{"message":"Bad key sk-or-standin-livegbe-0001 <img src=x onerror=alert(1)> ` + strings.Repeat("x", 5000) + `","code":401}}`
	err := embedOnce(t, answer{401, long})
	if !Permanent(err) || Rejected(err) {
		t.Fatalf("a refused key should stop the job: permanent %v, rejected %v", Permanent(err), Rejected(err))
	}
	if msg := err.Error(); strings.Contains(msg, "livegbe-0001") || len(msg) > 400 || !strings.HasPrefix(msg, "openrouter embed: Bad key sk-…") {
		t.Fatalf("saved error is %d bytes: %.120q", len(msg), msg)
	}

	if err := embedOnce(t, answer{200, `{"error":{"message":"Insufficient credits","code":402}}`}); !Permanent(err) {
		t.Fatalf("no credits in a 200 body should stop the job: %v", err)
	}
	if err := embedOnce(t, answer{400, `{"error":{"message":"input rejected"}}`}); !Rejected(err) || !Permanent(err) {
		t.Fatalf("a refused input is the item's own problem: %v", err)
	}

	err = embedOnce(t, answer{503, "<html><body><h1>503 Service Unavailable</h1></body></html>"})
	if Permanent(err) {
		t.Fatal("a server error may pass; it should be tried again")
	}
	if err.Error() != "openrouter embed: HTTP 503 Service Unavailable" {
		t.Fatalf("an HTML error page leaked into the error: %q", err.Error())
	}
	if err := embedOnce(t, answer{429, `{"error":{"message":"Rate limit exceeded"}}`}); Permanent(err) {
		t.Fatal("a rate limit passes; it should be tried again")
	}

	if err := CheckDims([][]float32{make([]float32, 3)}); !Permanent(err) {
		t.Fatalf("a model whose vectors do not fit will never fit: %v", err)
	}
}
