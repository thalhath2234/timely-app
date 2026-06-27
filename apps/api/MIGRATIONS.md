# Database Migrations with Goose

This document describes how to manage database migrations for the Timely API using Goose, a database migration tool for Go.

## Overview

This project uses **Goose** for professional, version-controlled database migrations. Goose provides:

- **Version Control**: Every schema change is tracked and versioned
- **Rollback Support**: Ability to revert migrations safely
- **Multi-environment Support**: Manage migrations across dev, staging, and production
- **Forward & Reverse Migrations**: Each migration has both `+goose Up` and `+goose Down` sections
- **Sequential Versioning**: Prevents conflicting migrations with timestamp-based naming

### Why Goose?

We moved away from GORM's `AutoMigrate` to Goose because:
- GORM AutoMigrate runs on every application startup, making schema changes implicit and unversioned
- Goose provides explicit, reproducible migrations for production reliability
- Enables safe rollbacks and schema versioning across team environments
- Supports multiple migration directions (up/down) for flexibility
- Industry-standard tool with strong community support

## Quick Start

### Prerequisites

1. Ensure your database is running and accessible
2. Copy `.env.example` to `.env` and configure your database credentials:

```bash
cp env.example .env
```

3. Install Goose CLI (optional, but recommended):

```bash
make install-goose
```

### Running Migrations

**Option 1: Automatic on Application Start** (Recommended)

Migrations run automatically when the application starts:

```bash
go run cmd/main.go
```

**Option 2: Manual with CLI**

Run all pending migrations:

```bash
make migrate-up
```

Check migration status:

```bash
make migrate-status
```

## Migration Management

### Creating a New Migration

Create a new migration file with descriptive naming:

```bash
make migrate-create NAME=add_user_role_column
```

This creates a file like: `migrations/20260617120000_add_user_role_column.sql`

### Migration File Structure

Each migration file contains `+goose Up` and `+goose Down` sections:

```sql
-- +goose Up
-- Create new column
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
CREATE INDEX idx_users_role ON users(role);

-- +goose Down
-- Revert changes
DROP INDEX idx_users_role;
ALTER TABLE users DROP COLUMN role;
```

**Best Practices for Writing Migrations:**

1. **Be Explicit**: Write clear, readable SQL
2. **Keep It Small**: One logical change per migration
3. **Always Provide Down Migration**: Ensure you can rollback
4. **Test Locally First**: Run migrations in development before production
5. **Add Indexes**: Create indexes for foreign keys and frequently queried columns
6. **Include Comments**: Document why the change was made
7. **Use Transactions**: Most database operations should be atomic (Goose handles this)

### Example Migration

```sql
-- +goose Up
-- Create custom fields table with proper indexes and constraints
CREATE TABLE custom_fields (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    type TEXT NOT NULL,
    options JSONB,
    created_at TEXT,
    updated_at TEXT
);

CREATE INDEX idx_custom_fields_workspace_id ON custom_fields(workspace_id);
CREATE INDEX idx_custom_fields_type ON custom_fields(type);

-- +goose Down
DROP INDEX IF EXISTS idx_custom_fields_type;
DROP INDEX IF EXISTS idx_custom_fields_workspace_id;
DROP TABLE IF EXISTS custom_fields;
```

## Common Migration Tasks

### Check Current Migration Status

```bash
make migrate-status
```

Output example:
```
database: postgres://localhost:5432/timely_db
Applied At                  Migration
===========================  =======================================================
2026-06-17 10:00:00         20260617100000_init_schema.sql
2026-06-17 10:05:00         20260617100500_add_indexes.sql
```

### Rollback Last Migration

```bash
make migrate-down
```

⚠️ **Warning**: This will revert the most recent migration. Use carefully in production.

### Reset All Migrations

```bash
make migrate-reset
```

⚠️ **DANGER**: This drops all tables and data, then reruns all migrations. Only use in development or testing.

### Manually Mark Migration as Applied

If a migration fails or needs to be marked applied without running:

```bash
make migrate-fix VERSION=20260617100000
```

## Environment-Specific Migrations

Use environment variables to target different databases:

```bash
# Development
DB_HOST=localhost DB_PORT=5432 DB_NAME=timely_db_dev make migrate-status

# Staging
DB_HOST=staging-db.example.com DB_PORT=5432 DB_NAME=timely_db_stg make migrate-status

# Production (with caution!)
DB_HOST=prod-db.example.com DB_PORT=5432 DB_NAME=timely_db make migrate-status
```

Or use the shorthand with Make:

```bash
make migrate-status DB_HOST=staging-db.example.com DB_NAME=timely_db_stg
```

## CI/CD Integration

### GitHub Actions Example

Add this to `.github/workflows/migrations.yml`:

```yaml
name: Database Migrations

on:
  push:
    branches: [main]
    paths:
      - 'migrations/**'
  workflow_dispatch:

jobs:
  migrate:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Go
        uses: actions/setup-go@v4
        with:
          go-version: '1.25'
      
      - name: Run migrations
        env:
          DB_HOST: ${{ secrets.DB_HOST }}
          DB_PORT: ${{ secrets.DB_PORT }}
          DB_USER: ${{ secrets.DB_USER }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
          DB_NAME: ${{ secrets.DB_NAME }}
        run: make migrate-status
```

### Deployment Strategy

**Recommended for Production:**

1. **Pre-Deployment**: Run `make migrate-status` to verify pending migrations
2. **Blue-Green Deployment**: Deploy new code with database migrations in this order:
   - Scale down old instances
   - Run migrations (backward compatible)
   - Scale up new instances
3. **Monitoring**: Watch application logs for migration-related errors
4. **Rollback Plan**: Keep documented procedures for rollback if needed

## Troubleshooting

### Migration Locked

If you see: `Error: database is locked`

This usually means another migration is running. Wait a moment and retry:

```bash
make migrate-status
```

### Migration Failed

If a migration fails:

1. Check the error message and database state
2. Fix the SQL if needed
3. Either:
   - Roll back and recreate: `make migrate-down`
   - Mark as fixed if it was a temporary issue: `make migrate-fix VERSION=<version>`

### Goose CLI Not Found

Install Goose CLI:

```bash
make install-goose
```

Or manually:

```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
```

## Migration Naming Conventions

Use this format for migration file names to maintain clarity:

- `YYYYMMDDHHMMSS_description.sql`
- Use snake_case for descriptions
- Be descriptive: `add_user_profile_table`, `drop_unused_column`, `rename_column`

Examples:
- ✅ `20260617100000_init_schema.sql`
- ✅ `20260617120000_add_user_role_column.sql`
- ✅ `20260617150000_create_audit_logs_table.sql`
- ❌ `migration1.sql`
- ❌ `update_db.sql`

## GORM Integration

While Goose handles schema migrations, GORM is still used for:

- **ORM Operations**: Querying and manipulating data
- **Model Relationships**: Defining foreign keys and relationships
- **Timestamps**: Using GORM hooks for created_at/updated_at

**Important**: GORM's `AutoMigrate` is now **disabled** to ensure migrations are explicit and version-controlled.

## Best Practices Summary

| Practice | Reason |
|----------|--------|
| Small, focused migrations | Easier to debug and rollback |
| Descriptive file names | Self-documenting schema evolution |
| Always write Down migrations | Enables safe rollbacks |
| Test in dev first | Catch issues before production |
| Include indexes | Improves query performance |
| Add comments | Explains the "why" for future developers |
| Use transactions | Ensures consistency |
| Monitor migrations | Catch issues early in production |
| Keep migration history | Audit trail of schema changes |

## References

- [Goose Documentation](https://github.com/pressly/goose)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Database Migration Best Practices](https://flywaydb.org/documentation/bestPractices)

## Getting Help

For migration-related issues or questions:

1. Check the [Goose GitHub Issues](https://github.com/pressly/goose/issues)
2. Review your PostgreSQL logs: `docker logs <postgres-container>`
3. Run `make migrate-status` to check the current state
4. Consult the team or project maintainer
