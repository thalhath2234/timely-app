package models

import "time"

type BackupSettings struct {
	UserID         string     `gorm:"type:text;primaryKey" json:"-"`
	Enabled        bool       `gorm:"not null;default:false" json:"enabled"`
	IntervalDays   int        `gorm:"not null;default:1" json:"intervalDays"`
	RetentionCount int        `gorm:"not null;default:7" json:"retentionCount"`
	NextRunAt      *time.Time `json:"nextRunAt"`
	CreatedAt      time.Time  `gorm:"not null" json:"createdAt"`
	UpdatedAt      time.Time  `gorm:"not null" json:"updatedAt"`
}

func (BackupSettings) TableName() string { return "backup_settings" }

type BackupFile struct {
	ID        string    `gorm:"type:text;primaryKey" json:"id"`
	UserID    string    `gorm:"type:text;not null" json:"-"`
	Path      string    `gorm:"type:text;not null" json:"-"`
	ByteSize  int64     `gorm:"not null" json:"byteSize"`
	Checksum  string    `gorm:"type:text;not null" json:"checksum"`
	CreatedAt time.Time `gorm:"not null" json:"createdAt"`
}

func (BackupFile) TableName() string { return "backup_files" }
