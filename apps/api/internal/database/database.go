package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"math"
	"os"
	"regexp"
	"strings"
	"time"

	"timely-api/migrations"

	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

// schemaName is what DB_SCHEMA may contain; it is spliced into SQL and the DSN.
var schemaName = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

func init() {
	goose.SetBaseFS(migrations.FS)
}

// RunMigrations applies the embedded Goose migrations.
func RunMigrations(db *sql.DB) error {
	if err := goose.Up(db, "."); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
}

// MigrationState reports the database's current schema version and how many
// embedded migrations are newer than it.
type MigrationState struct {
	Version int64 `json:"version"`
	Pending int   `json:"pending"`
}

func Migrations(ctx context.Context, db *sql.DB) (MigrationState, error) {
	current, err := goose.GetDBVersionContext(ctx, db)
	if err != nil {
		return MigrationState{}, err
	}
	all, err := goose.CollectMigrations(".", 0, math.MaxInt64)
	if err != nil {
		return MigrationState{Version: current}, err
	}
	pending := 0
	for _, m := range all {
		if m.Version > current {
			pending++
		}
	}
	return MigrationState{Version: current, Pending: pending}, nil
}

// Ping checks the connection with a short timeout.
func Ping(ctx context.Context, db *sql.DB) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return db.PingContext(ctx)
}

func InitDB() *gorm.DB {
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	dbname := os.Getenv("DB_NAME")
	sslmode := os.Getenv("DB_SSLMODE")

	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		host, user, password, dbname, port, sslmode)
	// DB_SCHEMA runs this instance (tables, migrations, workers) in its own
	// schema of a shared database, so a worktree API never claims jobs or chat
	// runs that belong to the main checkout.
	schema := strings.TrimSpace(os.Getenv("DB_SCHEMA"))
	if schema != "" && !schemaName.MatchString(schema) {
		log.Fatalf("DB_SCHEMA %q must be a plain lowercase identifier (letters, digits, underscores)", schema)
	}
	if schema != "" {
		dsn += " search_path=" + schema + ",public"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	if schema != "" {
		if err := db.Exec("CREATE SCHEMA IF NOT EXISTS " + schema).Error; err != nil {
			log.Fatalf("Failed to create schema %s: %v", schema, err)
		}
		// Keep goose's version table inside the schema; otherwise the shared
		// public one is found first and no tables are created here.
		goose.SetTableName(schema + ".goose_db_version")
	}

	log.Println("Database connection established")

	// Get raw SQL DB from GORM for Goose migrations
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("Failed to get raw database connection: %v", err)
	}

	// Run Goose migrations
	if err := RunMigrations(sqlDB); err != nil {
		log.Fatalf("Failed to run Goose migrations: %v", err)
	}

	DB = db
	return db
}
