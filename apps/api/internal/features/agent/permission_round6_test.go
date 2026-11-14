package agent

import "testing"

// Phase 5, review round 6: the agent must not reach Timely's own database or
// its secret files without a card (a psql UPDATE on the conversations row
// would turn Full Access on for its own chat), and the SQL delete patterns
// must match real table names.

func TestCriticalHostDatabaseDeletesWithRealNames(t *testing.T) {
	critical(t, CriticalDeleting, homeScope,
		`psql -c "TRUNCATE tasks"`,
		`psql -c "TRUNCATE TABLE tasks"`,
		`psql -d timely -c "TRUNCATE conversations CASCADE"`,
		`psql -c "TRUNCATE TABLE ONLY public.tasks, events"`,
		`psql -c "ALTER TABLE tasks DROP COLUMN title"`,
		`psql -c "DROP OWNED BY timely"`,
		`psql -c "DROP VIEW v"`,
		`psql -c "drop materialized view v"`,
		`psql -c "DROP ROLE app"`,
		`pg_restore --clean -d timely dump.pgdump`,
		`pg_restore -c -d timely dump.pgdump`,
		`mysqladmin -f drop prod`,
		`dropdb timely`,
		`dropuser timely`,
		`mongosh --eval "db.dropDatabase()"`,
	)
	// Plain prose and commands that only mention the word stay quiet.
	quiet(t, homeScope,
		`echo "please truncate long titles"`,
		`git log --oneline`,
		`ls -la`,
	)
}

func TestCriticalHostDatabaseClientsAlwaysAsk(t *testing.T) {
	critical(t, CriticalSettings, homeScope,
		`psql -h localhost -U timely -d timely -c "select count(*) from tasks"`,
		`PGPASSWORD=root123 psql -c "update conversations set permission='full'"`,
		`psql`,
		`sqlite3 app.db "select 1"`,
		`mysql -e "select 1"`,
		`mongosh --eval "1"`,
		`pg_dump timely > dump.sql`,
		`createdb scratch`,
		`/usr/bin/psql -c "select 1"`,
		`bash -c 'psql -c "select 1"'`,
		`echo ok | psql`,
	)
}

func TestCriticalHostSecretFilesAsk(t *testing.T) {
	critical(t, CriticalSettings, homeScope,
		`cat /home/me/Dev/timely-app/.env`,
		`cat .env`,
		`grep DB_PASSWORD ../.env`,
		`cat /home/me/.config/Timely/config.json`,
		`head -c 100 /home/me/.config/Timely-Dev/config.json`,
		`cat /proc/1234/environ`,
		`cat /home/me/.pgpass`,
		`cp /home/me/.config/Timely/Cookies ./c`,
	)
	for _, p := range []string{"/home/me/Dev/timely-app/.env", "/home/me/.config/Timely/config.json", "/proc/self/environ", "/home/me/.pgpass"} {
		item, reason, ok := CriticalHost(HostAction{Kind: HostFileRead, Path: p}, homeScope)
		wantCritical(t, CriticalSettings, "read_file "+p, item, reason, ok)
	}
	quiet(t, homeScope, `cat .env.example`, `cat README.md`, `cat package.json`, `ls -la`)
	item, reason, ok := CriticalHost(HostAction{Kind: HostFileRead, Path: "/home/me/work/notes.txt"}, homeScope)
	wantFine(t, "read_file notes", item, reason, ok)
}
