package database

import (
	"fmt"
	"log"
	"os"
	"timely-api/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func InitDB() *gorm.DB {
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	dbname := os.Getenv("DB_NAME")
	sslmode := os.Getenv("DB_SSLMODE")

	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		host, user, password, dbname, port, sslmode)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("Database connection established")

	// Run auto migrations
	err = db.AutoMigrate(
		&models.User{},
		&models.Priority{},
		&models.Project{},
		&models.Schedule{},
		&models.Stage{},
		&models.Status{},
		&models.Task{},
		&models.Workspace{},
	)

	DefaultSeeds(db)

	if err != nil {
		log.Fatalf("Failed to run database migrations: %v", err)
	}
	log.Println("Database migrations completed successfully")

	DB = db
	return db
}

func DefaultSeeds(db *gorm.DB) error {
	statuses := []models.Status{
		{Name: "Backlog", Color: "#6B7280"},
		{Name: "Todo", Color: "#3B82F6"},
		{Name: "In Progress", Color: "#F59E0B"},
		{Name: "Done", Color: "#10B981"},
		{Name: "Paused", Color: "#8B5CF6"},
		{Name: "Cancelled", Color: "#EF4444"},
	}

	priorities := []models.Priority{
		{Name: "Low", Level: 1},
		{Name: "Medium", Level: 2},
		{Name: "High", Level: 3},
		{Name: "Critical", Level: 4},
	}

	workspaces := []models.Workspace{
		{Name: "Default Workspace", Description: "Default workspace"},
	}
	err := db.FirstOrCreate(&workspaces[0]).Error
	if err != nil {
		return err
	}

	for _, status := range statuses {
		err := db.
			Where("name = ?", status.Name).
			FirstOrCreate(&status).Error

		if err != nil {
			return err
		}
	}

	for _, priority := range priorities {
		err := db.
			Where("name = ?", priority.Name).
			FirstOrCreate(&priority).Error

		if err != nil {
			return err
		}
	}
	return nil
}

