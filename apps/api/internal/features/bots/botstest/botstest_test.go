package botstest

import (
	"context"
	"errors"
	"syscall"
	"testing"

	"timely-api/internal/features/bots/fetch"
)

func TestNetwork(t *testing.T) {
	n := NewNetwork(map[string]Response{
		"https://shop.example/p":           Page("<html><body>₹199</body></html>"),
		"https://api.example/q?symbol=BTC": JSON(`{"price": 1}`),
		"https://api.example/q":            JSON(`{"price": 2}`),
		"https://down.example/":            {Err: syscall.ECONNRESET},
	})
	f := n.Fetcher()
	ctx := context.Background()

	res, err := f.Get(ctx, fetch.Request{URL: "https://shop.example/p", Want: fetch.WantPage})
	if err != nil || string(res.Body) != "<html><body>₹199</body></html>" || res.Status != 200 {
		t.Fatalf("page: %v %+v", err, res)
	}
	if n.Hits("https://shop.example/p") != 1 || n.Hits("https://shop.example/robots.txt") != 1 {
		t.Errorf("hits: page %d, robots %d", n.Hits("https://shop.example/p"), n.Hits("https://shop.example/robots.txt"))
	}
	// The full URL wins; another query falls back to the bare path.
	if res, err := f.Get(ctx, fetch.Request{URL: "https://api.example/q?symbol=BTC", Want: fetch.WantJSON}); err != nil || string(res.Body) != `{"price": 1}` {
		t.Errorf("full URL: %v %+v", err, res)
	}
	if res, err := f.Get(ctx, fetch.Request{URL: "https://api.example/q?symbol=ETH", Want: fetch.WantJSON}); err != nil || string(res.Body) != `{"price": 2}` {
		t.Errorf("bare URL: %v %+v", err, res)
	}
	if _, err := f.Get(ctx, fetch.Request{URL: "https://shop.example/missing", Want: fetch.WantPage}); !errors.Is(err, fetch.ErrNotFound) {
		t.Errorf("unknown URL: %v, want ErrNotFound", err)
	}
	if _, err := f.Get(ctx, fetch.Request{URL: "https://down.example/", Want: fetch.WantPage}); !errors.Is(err, fetch.ErrOffline) {
		t.Errorf("a broken connection: %v, want ErrOffline", err)
	}
	n.Set("https://shop.example/missing", Page("<html>now here</html>"))
	if _, err := Net(nil).Get(ctx, fetch.Request{URL: "https://shop.example/p", Want: fetch.WantPage}); !errors.Is(err, fetch.ErrNotFound) {
		t.Errorf("an empty Net: %v", err)
	}
	if res, err := f.Get(ctx, fetch.Request{URL: "https://shop.example/missing", Want: fetch.WantPage}); err != nil || string(res.Body) != "<html>now here</html>" {
		t.Errorf("after Set: %v %+v", err, res)
	}
}
