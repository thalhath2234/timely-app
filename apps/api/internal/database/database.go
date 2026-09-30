package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

// RunMigrations executes Goose migrations from the migrations directory
func RunMigrations(db *sql.DB) error {
	if err := goose.Up(db, "migrations"); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
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
	if schema != "" {
		dsn += " search_path=" + schema + ",public" // public keeps extensions such as pgvector reachable
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
