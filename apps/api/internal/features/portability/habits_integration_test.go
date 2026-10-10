package portability

import (
	"encoding/json"
	"testing"

	"timely-api/internal/models"
)

// A backup carries habits, their checks and goals, and restore keeps them
// on the restoring account; a check on another account's habit is refused.
func TestIntegrationBackupKeepsHabitsAndGoals(t *testing.T) {
	db := migratedDB(t)
	const uid, other = "usr_portability_habits", "usr_portability_other"
	for _, row := range []any{
		&models.User{ID: uid, Email: "habits@example.invalid", Password: "not-a-real-hash"},
		&models.User{ID: other, Email: "other@example.invalid", Password: "not-a-real-hash"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, q := range []string{
		`INSERT INTO habits (id, user_id, name, position) VALUES ('hab_1', '` + uid + `', 'Walk', 0), ('hab_x', '` + other + `', 'Read', 0)`,
		`INSERT INTO habit_checks (habit_id, user_id, day) VALUES ('hab_1', '` + uid + `', '2026-10-09'), ('hab_1', '` + uid + `', '2026-10-10')`,
		`INSERT INTO goals (id, user_id, title, position) VALUES ('goal_1', '` + uid + `', 'Run a 10k', 0)`,
	} {
		if err := db.Exec(q).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(db, nil)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	if len(backup.Rows["habits"]) != 1 || len(backup.Rows["habit_checks"]) != 2 || len(backup.Rows["goals"]) != 1 {
		t.Fatalf("export rows: habits %d checks %d goals %d", len(backup.Rows["habits"]), len(backup.Rows["habit_checks"]), len(backup.Rows["goals"]))
	}
	if err := db.Exec(`INSERT INTO habits (id, user_id, name, position) VALUES ('hab_new', ?, 'Stretch', 1)`, uid).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}
	var habits, checks, goals int64
	db.Raw(`SELECT count(*) FROM habits WHERE user_id = ?`, uid).Scan(&habits)
	db.Raw(`SELECT count(*) FROM habit_checks WHERE user_id = ?`, uid).Scan(&checks)
	db.Raw(`SELECT count(*) FROM goals WHERE user_id = ?`, uid).Scan(&goals)
	if habits != 1 || checks != 2 || goals != 1 {
		t.Fatalf("after restore: habits %d checks %d goals %d", habits, checks, goals)
	}

	// A crafted check pointing at another account's habit is refused.
	raw, _ := json.Marshal(map[string]any{"id": "hab_x:2026-10-10", "habit_id": "hab_x", "user_id": uid, "day": "2026-10-10"})
	backup.Rows["habit_checks"] = append(backup.Rows["habit_checks"], raw)
	if _, err := service.Restore(uid, backup); err == nil {
		t.Fatal("restore accepted a check on another account's habit")
	}
	db.Raw(`SELECT count(*) FROM habit_checks WHERE habit_id = 'hab_x'`).Scan(&checks)
	if checks != 0 {
		t.Fatalf("foreign habit got %d checks", checks)
	}
}
