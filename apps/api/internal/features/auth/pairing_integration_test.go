package auth

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Opt-in because it needs the migrated Postgres schema (DB_SCHEMA is honoured).
// Run with TIMELY_TEST_POSTGRES=1 go test ./internal/features/auth -run PairingCodesPostgres.
func TestPairingCodesPostgres(t *testing.T) {
	if os.Getenv("TIMELY_TEST_POSTGRES") != "1" {
		t.Skip("set TIMELY_TEST_POSTGRES=1 to run the Postgres pairing code test")
	}
	_ = godotenv.Load("../../../../../.env")
	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"), os.Getenv("DB_PORT"), os.Getenv("DB_SSLMODE"))
	if schema := strings.TrimSpace(os.Getenv("DB_SCHEMA")); schema != "" {
		dsn += " search_path=" + schema + ",public"
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })

	userID := fmt.Sprintf("usr_pair_%d", time.Now().UnixNano())
	if err := tx.Exec(`INSERT INTO users (id,email,name,password,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
		userID, userID+"@example.test", "Pair", "x", "2026-10-30", "2026-10-30").Error; err != nil {
		t.Fatal(err)
	}

	codes := NewPairingCodes(tx)
	code, expires, err := codes.Create(userID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(code, "pair_") || time.Until(expires) > PairingCodeTTL || time.Until(expires) < PairingCodeTTL-time.Minute {
		t.Fatalf("code %q expires %v", code, expires)
	}
	var stored int64
	tx.Raw(`SELECT count(*) FROM pairing_codes WHERE code_hash = ?`, code).Scan(&stored)
	if stored != 0 {
		t.Fatal("the code itself was stored; only its hash may be")
	}

	if _, err := codes.Redeem("pair_unknown"); err != ErrPairingCode {
		t.Fatalf("unknown code: %v", err)
	}
	got, err := codes.Redeem(code)
	if err != nil || got != userID {
		t.Fatalf("first redeem = %q, %v", got, err)
	}
	if _, err := codes.Redeem(code); err != ErrPairingCode {
		t.Fatalf("second redeem: %v", err)
	}

	late, _, err := codes.Create(userID)
	if err != nil {
		t.Fatal(err)
	}
	codes.now = func() time.Time { return time.Now().Add(PairingCodeTTL + time.Second) }
	if _, err := codes.Redeem(late); err != ErrPairingCode {
		t.Fatalf("expired redeem: %v", err)
	}
}
