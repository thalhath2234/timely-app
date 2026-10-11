package auth

import (
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type UserRepository interface {
	CreateUser(user *models.User) error
	GetUserByEmail(email string) (*models.User, error)
	GetUserByID(userID string) (*models.User, error)
	UpdateUser(user *models.User) error
	CountUsers() (int64, error)
	DeleteUser(userID string) error
}

type userRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) UserRepository {
	return &userRepository{db: db}
}

func (r *userRepository) CreateUser(user *models.User) error {
	tx := r.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Create(user).Error; err != nil {
		tx.Rollback()
		return err
	}
	config := &models.Config{
		ID:                    utils.NewConfigID(),
		UserID:                user.ID,
		IsOnBoardingCompleted: false,
		TaskViews:             models.DefaultTaskViews(),
		ActiveTaskViewId:      "view_task_list",
		Appearance:            models.DefaultAppearance(),
	}

	if err := tx.Create(config).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

func (r *userRepository) GetUserByEmail(email string) (*models.User, error) {
	var user models.User
	err := r.db.Where("LOWER(email) = ?", NormalizeEmail(email)).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) GetUserByID(userID string) (*models.User, error) {
	var user models.User
	err := r.db.Where("id = ?", userID).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) UpdateUser(user *models.User) error {
	return r.db.Model(user).Select("Email", "Name", "Password", "UpdatedAt").Updates(user).Error
}

func (r *userRepository) CountUsers() (int64, error) {
	var n int64
	err := r.db.Model(&models.User{}).Count(&n).Error
	return n, err
}

// accountCleanup removes the rows an account owns that no foreign key
// cascades from users: stages hang off projects without one, and jobs,
// notifications and push devices carry user_id as a plain column. Deleting
// the users row then cascades to everything else.
var accountCleanup = []string{
	`DELETE FROM stages WHERE project_id IN (SELECT p.id FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ?)`,
	`DELETE FROM jobs WHERE user_id = ?`,
	`DELETE FROM notifications WHERE user_id = ?`,
	`DELETE FROM push_devices WHERE user_id = ?`,
}

// DeleteUser removes the account and everything it owns in one transaction.
func (r *userRepository) DeleteUser(userID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Schedules are shared rows that tasks point at; drop the ones only
		// this account's tasks used once those tasks are gone.
		var schedules []string
		if err := tx.Raw(`SELECT DISTINCT schedule_id FROM tasks WHERE user_id = ? AND schedule_id IS NOT NULL`, userID).Scan(&schedules).Error; err != nil {
			return err
		}
		for _, query := range accountCleanup {
			if err := tx.Exec(query, userID).Error; err != nil {
				return err
			}
		}
		result := tx.Exec(`DELETE FROM users WHERE id = ?`, userID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		if len(schedules) > 0 {
			return tx.Exec(`DELETE FROM schedules s WHERE s.id IN ? AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.schedule_id = s.id)`, schedules).Error
		}
		return nil
	})
}
