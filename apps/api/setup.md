# Timely API - Initial Setup Guide

Welcome to **Timely API**, a Go-based backend REST API built with [Echo v5](https://echo.labstack.com/), [GORM](https://gorm.io/), and [Goose](https://pressly.github.io/goose/) for database migrations.

This guide will walk you through setting up your local development environment from scratch.

---

## 📋 Prerequisites

Before running the application, ensure you have the following installed on your machine:

1. **Go** (Version `1.22` or later, recommended `1.25+`)
   - Download & Install: [golang.org/dl](https://golang.org/dl/)
   - Verify installation:
     ```bash
     go version
     ```

2. **PostgreSQL** (Version `14+`)
   - Download & Install: [postgresql.org/download](https://www.postgresql.org/download/) or run via Docker:
     ```bash
     docker run --name timely-postgres -e POSTGRES_USER=timely -e POSTGRES_PASSWORD=root123 -e POSTGRES_DB=timely_db -p 5432:5432 -d postgres:16
     ```
   - Verify connection:
     ```bash
     psql -U timely -d timely_db -h localhost
     ```

3. **Make** (Optional but recommended for helper commands)
   - Windows: Install via Chocolatey (`choco install make`) or Git Bash.
   - macOS/Linux: Pre-installed or via package manager.

4. **Air** (Optional, for hot reloading)
   - Install CLI:
     ```bash
     go install github.com/air-verse/air@latest
     ```

---

## ⚙️ Environment Configuration

1. **Copy Environment Template**
   Duplicate [env.example](file:///c:/Dev/timely-api/env.example) to create your local `.env` file:

   ```bash
   cp env.example .env
   ```

2. **Configure Variables**
   Open [.env](file:///c:/Dev/timely-api/.env) and update parameters if necessary:

   ```ini
   # Database Configuration
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=timely
   DB_PASSWORD=root123
   DB_NAME=timely_db
   DB_SSLMODE=disable

   # Application Port
   PORT=8080

   # JWT Secret Key
   JWT_SECRET=n8SL1dOBK/0miN65rn9+2LJgV7kdxRDrWHzUJtHnrLs=
   ```

---

## 🗄️ Database Setup & Migrations

### 1. Create PostgreSQL Database

If you are not using Docker, log in to PostgreSQL CLI or your SQL client (e.g. DBeaver, pgAdmin) and execute:

```sql
CREATE USER timely WITH PASSWORD 'root123';
CREATE DATABASE timely_db OWNER timely;
GRANT ALL PRIVILEGES ON DATABASE timely_db TO timely;
```

### 2. Install Goose CLI (Recommended)

To execute manual database schema operations and seeds, install the Goose migration CLI:

```bash
make install-goose
```

### 3. Run Database Migrations & Seeds

- **Automatic Migrations**: When starting the main application, Goose migrations run automatically on server initialization.
- **Manual Migrations**:
  ```bash
  # Apply all pending UP migrations
  make migrate-up

  # Apply seed mock data
  make migrate-seed
  ```

For comprehensive details on managing schema migrations, refer to [MIGRATIONS.md](file:///c:/Dev/timely-api/MIGRATIONS.md).

---

## 🚀 Running the Application

### Option A: Standard Go Run

```bash
go run cmd/main.go
```

The API server will launch at `http://localhost:8080`.

### Option B: Live Reload with Air

For live hot-reloading during development:

```bash
air
```

---

## 🧪 Testing & API Collections

- **API Documentation & Collections**: You can import [api-collections.json](file:///c:/Dev/timely-api/api-collections.json) into Postman, Insomnia, or Bruno to test API endpoints (Auth, Workspaces, Projects, Tasks).
- **CORS Support**: Default CORS allows requests from `http://localhost:3000`.

---

## 🛠️ Helpful Makefile Commands

Run `make help` to view all available commands:

| Command | Description |
| :--- | :--- |
| `make migrate-up` | Run pending database migrations |
| `make migrate-status` | View current migration status |
| `make migrate-down` | Roll back the last database migration |
| `make migrate-seed` | Apply seed data from `migrations/seeds` |
| `make migrate-unseed` | Roll back last seed data migration |
| `make migrate-create NAME=...` | Create a new SQL migration file |
| `make install-goose` | Install the Goose CLI tool |

---

## ❓ Troubleshooting

- **Database Connection Error (`connection refused`)**: Check if PostgreSQL server is active and running on port `5432`.
- **Permission Denied / Password Authentication Failed**: Verify credentials in `.env` match your PostgreSQL setup.
- **Port Conflict (`listen tcp :8080: bind: address already in use`)**: Change `PORT` in `.env` or terminate the process occupying port `8080`.
