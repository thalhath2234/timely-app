package bots

import (
	"fmt"
	"testing"
	"time"
)

func TestPreviewKey(t *testing.T) {
	page := Watch{Kind: WatchPage, URL: "https://shop.example/p/1", ReadMode: ReadProductPrice}
	same := page
	same.Rules = jsonList[Rule]{{Kind: RuleAnyChange}}
	same.ID = "bwt_other"
	if previewKey("usr_a", page) != previewKey("usr_a", same) {
		t.Error("rules and ids must not change the key: they do not change what is read")
	}
	for name, w := range map[string]Watch{
		"read":     {Kind: WatchPage, URL: page.URL, ReadMode: ReadText},
		"selector": {Kind: WatchPage, URL: page.URL, ReadMode: ReadSelectorPrice, Selector: "p.price"},
		"url":      {Kind: WatchPage, URL: page.URL + "?x=1", ReadMode: ReadProductPrice},
		"kind":     {Kind: WatchFeed, URL: page.URL},
	} {
		if previewKey("usr_a", w) == previewKey("usr_a", page) {
			t.Errorf("%s: a different config must have its own key", name)
		}
	}
	if previewKey("usr_a", page) == previewKey("usr_b", page) {
		t.Error("each person has their own readings")
	}
	coin := Watch{Kind: WatchPrice, Source: "coinbase", Symbol: "BTC", Currency: "USD"}
	eur := coin
	eur.Currency = "EUR"
	if previewKey("usr_a", coin) == previewKey("usr_a", eur) {
		t.Error("the currency is part of the key")
	}
	// The parts are separated so one cannot run into the next.
	a := Watch{Kind: WatchPage, URL: "https://a.example/x", ReadMode: ReadSelector, Selector: "b"}
	b := Watch{Kind: WatchPage, URL: "https://a.example/x" + "\x00" + ReadSelector, ReadMode: "", Selector: "b"}
	if previewKey("u", a) == previewKey("u", b) {
		t.Error("keys of different configs collided")
	}
}

func TestPreviewMemoTTL(t *testing.T) {
	m := newPreviewMemo(10*time.Minute, 500)
	t0 := botNow
	v := 19999.0
	m.put("k", PreviewWatch{OK: true, Summary: "₹19,999", Value: &v, Candidates: []PreviewCandidate{{Label: "Deal Price", Amount: v}}}, t0)

	got, ok := m.get("k", t0.Add(10*time.Minute-time.Second))
	if !ok || got.Summary != "₹19,999" || got.Value == nil || *got.Value != v {
		t.Fatalf("within the TTL: %+v %v", got, ok)
	}
	// What get returns is a copy: changing it leaves the memo as it was.
	*got.Value = 1
	got.Candidates[0].Label = "changed"
	again, _ := m.get("k", t0.Add(time.Minute))
	if *again.Value != v || again.Candidates[0].Label != "Deal Price" {
		t.Error("a caller changed the memo through its copy")
	}

	if _, ok := m.get("k", t0.Add(10*time.Minute)); ok {
		t.Error("a reading 10 minutes old must be read again")
	}
	if m.len() != 0 {
		t.Errorf("an expired entry is dropped; %d left", m.len())
	}
	if _, ok := m.get("missing", t0); ok {
		t.Error("an unknown key is a miss")
	}

	// A clock that went back cannot make an entry last longer.
	m.put("k", PreviewWatch{OK: true}, t0)
	if _, ok := m.get("k", t0.Add(-time.Minute)); ok {
		t.Error("an entry from the future is a miss")
	}
}

func TestPreviewMemoEviction(t *testing.T) {
	m := newPreviewMemo(10*time.Minute, 3)
	t0 := botNow
	for i := range 3 {
		m.put(fmt.Sprint("k", i), PreviewWatch{Summary: fmt.Sprint(i)}, t0.Add(time.Duration(i)*time.Second))
	}
	// Putting k0 again makes it the newest, so k1 is now the oldest.
	m.put("k0", PreviewWatch{Summary: "0 again"}, t0.Add(3*time.Second))
	m.put("k3", PreviewWatch{Summary: "3"}, t0.Add(4*time.Second))
	if m.len() != 3 {
		t.Fatalf("len %d, want the cap of 3", m.len())
	}
	now := t0.Add(5 * time.Second)
	if _, ok := m.get("k1", now); ok {
		t.Error("the oldest entry should have been dropped")
	}
	for _, k := range []string{"k0", "k2", "k3"} {
		if _, ok := m.get(k, now); !ok {
			t.Errorf("%s should still be remembered", k)
		}
	}
	if got, _ := m.get("k0", now); got.Summary != "0 again" {
		t.Errorf("k0 = %q, want the newer reading", got.Summary)
	}

	// Expired entries at the front go when something new comes in.
	m.put("k4", PreviewWatch{}, t0.Add(10*time.Minute+3*time.Second))
	if m.len() != 2 { // k3 (4 s) and k4 remain; k0 (3 s) and k2 (2 s) expired
		t.Errorf("len %d after expiry, want 2", m.len())
	}
}

func TestPreviewMemoDefaults(t *testing.T) {
	if previews.memo.ttl != 10*time.Minute || previews.memo.max != 500 {
		t.Errorf("memo ttl %v max %d, want 10m and 500", previews.memo.ttl, previews.memo.max)
	}
	if previews.limit.per != 12 || previews.limit.window != time.Minute {
		t.Errorf("limit %d per %v, want 12 per minute", previews.limit.per, previews.limit.window)
	}
}

func TestPreviewLimiter(t *testing.T) {
	l := newPreviewLimiter(12, time.Minute)
	t0 := botNow
	for i := range 12 {
		if !l.take("usr_a", 1, t0.Add(time.Duration(i)*time.Second)) {
			t.Fatalf("read %d refused under the limit", i+1)
		}
	}
	if l.take("usr_a", 1, t0.Add(12*time.Second)) {
		t.Error("the 13th read in a minute must be refused")
	}
	if !l.take("usr_b", 5, t0.Add(12*time.Second)) {
		t.Error("each person has their own limit")
	}
	// The first read leaves the window a minute after it was made.
	if !l.take("usr_a", 1, t0.Add(time.Minute+time.Millisecond)) {
		t.Error("a read a minute old no longer counts")
	}
	if l.take("usr_a", 1, t0.Add(time.Minute+2*time.Millisecond)) {
		t.Error("only one slot came free")
	}

	// All or nothing: 3 reads with 2 left are refused and count nothing.
	l = newPreviewLimiter(12, time.Minute)
	if !l.take("usr_c", 10, t0) {
		t.Fatal("10 of 12")
	}
	if l.take("usr_c", 3, t0) {
		t.Error("3 more would make 13")
	}
	if !l.take("usr_c", 2, t0) {
		t.Error("the refused take must not have counted")
	}

	// A person with nothing in the window is forgotten.
	l.take("usr_c", 1, t0.Add(2*time.Minute))
	if len(l.reads["usr_c"]) != 1 {
		t.Errorf("old reads kept: %v", l.reads["usr_c"])
	}
	l.recent("usr_c", t0.Add(5*time.Minute))
	if _, ok := l.reads["usr_c"]; ok {
		t.Error("an idle person should be dropped from the limiter")
	}
}
