package auth

import (
	"errors"
	"os"
	"strconv"
	"time"
	"timely-api/internal/features/workspace"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type AuthService interface {
	Register(email, password string) (*models.User, error)
	Login(email, password string) (string, error)
}

type JWTClaims struct {
	UserID                string `json:"user_id"`
	Email                 string `json:"email"`
	IsOnBoardingCompleted bool   `json:"is_on_boarding_completed"`
	jwt.RegisteredClaims
}

type authService struct {
	repo      UserRepository
	workspace workspace.WorkspaceRepository
}

func NewAuthService(
	repo UserRepository,
	workspaceRepo workspace.WorkspaceRepository,
) AuthService {
	return &authService{
		repo:      repo,
		workspace: workspaceRepo,
	}
}

func (s *authService) Register(email, password string) (*models.User, error) {
	if email == "" || password == "" {
		return nil, errors.New("email and password cannot be empty")
	}

	existingUser, _ := s.repo.GetUserByEmail(email)
	if existingUser != nil {
		return nil, errors.New("user with this email already exists")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &models.User{
		Email:    email,
		Password: string(hashedPassword),
	}

	user.ID = utils.NewUserID()

	err = s.repo.CreateUser(user)
	if err != nil {
		return nil, err
	}

	return user, nil
}

func (s *authService) Login(email, password string) (string, error) {
	if email == "" || password == "" {
		return "", errors.New("email and password cannot be empty")
	}

	user, err := s.repo.GetUserByEmail(email)
	if err != nil {
		return "", errors.New("invalid email or password")
	}

	config, err := s.workspace.GetConfig(user.ID)

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password))
	if err != nil {
		return "", errors.New("invalid email or password")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		panic("JWT_SECRET missing")
	}

	expiryHoursStr := os.Getenv("JWT_EXPIRY_HOURS")
	expiryHours, err := strconv.Atoi(expiryHoursStr)
	if err != nil {
		expiryHours = 24
	}

	claims := &JWTClaims{
		UserID:                user.ID,
		Email:                 user.Email,
		IsOnBoardingCompleted: config.IsOnBoardingCompleted,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(expiryHours) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "timely-api",
			Audience:  []string{"timely-client"},
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(jwtSecret))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}
