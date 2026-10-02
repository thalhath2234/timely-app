// Command reset_password sets a user's password from the local machine.
// Email delivery is intentionally not part of Timely; this is the documented
// local administration recovery path.
//
//	go run ./scripts/reset_password.go -email user@example.com -password 'new-password'
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"timely-api/internal/database"
	"timely-api/internal/features/auth"
	"timely-api/internal/models"

	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	emailFlag := flag.String("email", "", "account email")
	passwordFlag := flag.String("password", "", "new password (min 8 characters)")
	flag.Parse()

	email := auth.NormalizeEmail(*emailFlag)
	password := *passwordFlag
	if !auth.ValidateEmail(email) || len(password) < 8 {
		log.Fatal("usage: reset_password -email user@example.com -password 'new-password'")
	}

	_ = godotenv.Load("../../.env")
	db := database.InitDB()

	var user models.User
	if err := db.Where("LOWER(email) = ?", email).First(&user).Error; err != nil {
		log.Fatalf("user not found: %v", err)
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal(err)
	}
	if err := db.Model(&user).Update("password", string(hashed)).Error; err != nil {
		log.Fatal(err)
	}

	fmt.Fprintf(os.Stdout, "password updated for %s\n", user.Email)
}
