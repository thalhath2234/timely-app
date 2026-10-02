package agent

import (
	"context"
	"testing"
	"time"
)

func TestToolsDefaultToTheChatTimezone(t *testing.T) {
	ctx := WithTimezone(context.Background(), "Asia/Tokyo")
	if zone(ctx, "") != "Asia/Tokyo" || zone(ctx, "Europe/Berlin") != "Europe/Berlin" {
		t.Fatal("explicit arguments must win over the chat timezone")
	}
	if location(ctx, "").String() != "Asia/Tokyo" {
		t.Fatal("chat timezone ignored")
	}
	// Hermes calls carry no timezone and keep the server's zone.
	if location(context.Background(), "") != time.Local {
		t.Fatal("Hermes default changed")
	}
	from, _, loc, err := (&Server{}).parseRange(ctx, rangeIn{}, 1)
	if err != nil || loc.String() != "Asia/Tokyo" || from.Hour() != 0 || from.Location().String() != "Asia/Tokyo" {
		t.Fatalf("range starts at %v in %v (%v)", from, loc, err)
	}
}

func TestSpanFormatsLocalRanges(t *testing.T) {
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	start := time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC)
	if got := span(start, start.Add(8*time.Hour), tokyo); got != "Tue 2026-10-06 10:00–18:00" {
		t.Fatal(got)
	}
	if got := span(start.Add(14*time.Hour), start.Add(16*time.Hour), tokyo); got != "Wed 2026-10-07 00:00–02:00" {
		t.Fatal(got)
	}
	if got := span(start.Add(12*time.Hour), start.Add(16*time.Hour), tokyo); got != "Tue 2026-10-06 22:00 – Wed 2026-10-07 02:00" {
		t.Fatal(got)
	}
}
