package models

import (
	"testing"
	"time"
)

// Go names the server's own zone "Local", which nothing else can resolve.
func TestZoneNameNeverReturnsLocal(t *testing.T) {
	prev := time.Local
	t.Cleanup(func() { time.Local = prev })
	time.Local = time.FixedZone("Local", 9*60*60)

	if got := ZoneName(time.Local); got != "" {
		t.Fatalf("ZoneName(server zone) = %q, want unknown", got)
	}
	if got := ZoneName(nil); got != "" {
		t.Fatalf("ZoneName(nil) = %q, want unknown", got)
	}
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Skip("no tzdata")
	}
	if got := ZoneName(berlin); got != "Europe/Berlin" {
		t.Fatalf("ZoneName(Berlin) = %q", got)
	}
	if got := ClientZoneName(time.Local); got == "Local" {
		t.Fatalf("ClientZoneName(server zone) = %q, want an IANA name or unknown", got)
	}
	if got := ClientZoneName(berlin); got != "Europe/Berlin" {
		t.Fatalf("ClientZoneName(Berlin) = %q", got)
	}
}

func TestServerZoneNameReadsTZ(t *testing.T) {
	t.Setenv("TZ", "Asia/Tokyo")
	if got := ServerZoneName(); got != "Asia/Tokyo" {
		t.Fatalf("ServerZoneName with TZ = %q, want Asia/Tokyo", got)
	}
	t.Setenv("TZ", "Local")
	if got := ServerZoneName(); got == "Local" {
		t.Fatalf("ServerZoneName must not be Local")
	}
}
