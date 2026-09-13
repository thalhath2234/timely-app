package portability

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var encryptedMagic = []byte("TLBK1")

type Service struct {
	db    *gorm.DB
	queue *jobs.Queue
	dir   string
	key   [32]byte
}

func NewService(db *gorm.DB, queue *jobs.Queue) *Service {
	dir := strings.TrimSpace(os.Getenv("TIMELY_BACKUP_DIR"))
	if dir == "" {
		dir = "data/backups"
	}
	secret := strings.TrimSpace(os.Getenv("TIMELY_BACKUP_KEY"))
	if secret == "" {
		secret = os.Getenv("JWT_SECRET")
	}
	return &Service{db: db, queue: queue, dir: dir, key: sha256.Sum256([]byte("timely-backup:" + secret))}
}

func (s *Service) Register(worker *jobs.Worker) {
	worker.Handle(models.JobCreateBackup, s.HandleBackup)
}

func defaultSettings(userID string) models.BackupSettings {
	now := time.Now().UTC()
	return models.BackupSettings{
		UserID: userID, IntervalDays: 1, RetentionCount: 7,
		CreatedAt: now, UpdatedAt: now,
	}
}

func normalizeSettings(in models.BackupSettings) (models.BackupSettings, error) {
	if in.IntervalDays < 1 || in.IntervalDays > 30 {
		return in, errors.New("intervalDays must be between 1 and 30")
	}
	if in.RetentionCount < 1 || in.RetentionCount > 30 {
		return in, errors.New("retentionCount must be between 1 and 30")
	}
	return in, nil
}

func (s *Service) GetSettings(userID string) (models.BackupSettings, error) {
	settings := defaultSettings(userID)
	err := s.db.Where("user_id = ?", userID).First(&settings).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return settings, nil
	}
	return settings, err
}

func (s *Service) UpdateSettings(userID string, input models.BackupSettings) (models.BackupSettings, error) {
	input.UserID = userID
	input.CreatedAt = time.Now().UTC()
	input.UpdatedAt = input.CreatedAt
	if input.Enabled {
		next := time.Now().UTC().Add(time.Duration(input.IntervalDays) * 24 * time.Hour)
		input.NextRunAt = &next
	} else {
		input.NextRunAt = nil
	}
	normalized, err := normalizeSettings(input)
	if err != nil {
		return input, err
	}
	err = s.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"enabled": normalized.Enabled, "interval_days": normalized.IntervalDays,
			"retention_count": normalized.RetentionCount, "next_run_at": normalized.NextRunAt,
			"updated_at": normalized.UpdatedAt,
		}),
	}).Create(&normalized).Error
	return normalized, err
}

func (s *Service) CreateEncrypted(userID string) (*models.BackupFile, error) {
	backup, err := s.Export(userID)
	if err != nil {
		return nil, err
	}
	plain, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return nil, err
	}
	sealed, err := s.encrypt(plain)
	if err != nil {
		return nil, err
	}
	id := utils.NewBackupID()
	accountDir := filepath.Join(s.dir, safeAccountDirectory(userID))
	if err := os.MkdirAll(accountDir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(accountDir, id+".tlbk")
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, sealed, 0600); err != nil {
		return nil, err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return nil, err
	}
	row := &models.BackupFile{
		ID: id, UserID: userID, Path: path, ByteSize: int64(len(sealed)),
		Checksum: checksum(plain), CreatedAt: time.Now().UTC(),
	}
	if err := s.db.Create(row).Error; err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	settings, _ := s.GetSettings(userID)
	if err := s.prune(userID, settings.RetentionCount); err != nil {
		return row, err
	}
	return row, nil
}

func safeAccountDirectory(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return fmt.Sprintf("account-%x", sum[:12])
}

func (s *Service) encrypt(plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(s.key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	out := append(append([]byte{}, encryptedMagic...), nonce...)
	return gcm.Seal(out, nonce, plain, encryptedMagic), nil
}

func (s *Service) decrypt(sealed []byte) ([]byte, error) {
	if len(sealed) < len(encryptedMagic) || string(sealed[:len(encryptedMagic)]) != string(encryptedMagic) {
		return nil, errors.New("invalid encrypted backup")
	}
	block, err := aes.NewCipher(s.key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	offset := len(encryptedMagic)
	if len(sealed) < offset+gcm.NonceSize() {
		return nil, errors.New("invalid encrypted backup")
	}
	nonce := sealed[offset : offset+gcm.NonceSize()]
	return gcm.Open(nil, nonce, sealed[offset+gcm.NonceSize():], encryptedMagic)
}

func (s *Service) List(userID string) ([]models.BackupFile, error) {
	var rows []models.BackupFile
	err := s.db.Where("user_id = ?", userID).Order("created_at desc").Find(&rows).Error
	if rows == nil {
		rows = []models.BackupFile{}
	}
	return rows, err
}

func (s *Service) Read(userID, id string) ([]byte, *models.BackupFile, error) {
	var row models.BackupFile
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		return nil, nil, err
	}
	sealed, err := os.ReadFile(row.Path)
	if err != nil {
		return nil, nil, err
	}
	plain, err := s.decrypt(sealed)
	if err != nil {
		return nil, nil, err
	}
	if checksum(plain) != row.Checksum {
		return nil, nil, errors.New("backup checksum mismatch")
	}
	return plain, &row, nil
}

func (s *Service) Delete(userID, id string) error {
	var row models.BackupFile
	if err := s.db.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		return err
	}
	if err := os.Remove(row.Path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return s.db.Where("id = ? AND user_id = ?", id, userID).Delete(&models.BackupFile{}).Error
}

func (s *Service) prune(userID string, retain int) error {
	if retain < 1 {
		retain = 7
	}
	rows, err := s.List(userID)
	if err != nil {
		return err
	}
	if len(rows) <= retain {
		return nil
	}
	for _, row := range rows[retain:] {
		if err := s.Delete(userID, row.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Sweep(ctx context.Context) error {
	var due []models.BackupSettings
	if err := s.db.WithContext(ctx).Where("enabled = true AND next_run_at <= ?", time.Now().UTC()).Find(&due).Error; err != nil {
		return err
	}
	sort.Slice(due, func(i, j int) bool { return due[i].UserID < due[j].UserID })
	for _, settings := range due {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		date := time.Now().UTC().Format("2006-01-02")
		if _, err := s.queue.Enqueue(jobs.Enqueue{
			UserID: settings.UserID, Kind: models.JobCreateBackup,
			DedupeKey: "backup:" + settings.UserID + ":" + date,
			Payload:   models.JobPayload{"scheduled": true},
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) HandleBackup(ctx context.Context, job *models.Job) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if _, err := s.CreateEncrypted(job.UserID); err != nil {
		return err
	}
	settings, err := s.GetSettings(job.UserID)
	if err != nil || !settings.Enabled {
		return err
	}
	next := time.Now().UTC().Add(time.Duration(settings.IntervalDays) * 24 * time.Hour)
	return s.db.Model(&models.BackupSettings{}).Where("user_id = ?", job.UserID).
		Updates(map[string]any{"next_run_at": next, "updated_at": time.Now().UTC()}).Error
}
