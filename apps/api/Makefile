# .PHONY: migrate-up migrate-down migrate-status migrate-create migrate-reset migrate-fix migrate-seed migrate-unseed install-goose help

# # Auto-load variables from .env when present.
# ifneq (,$(wildcard .env))
# include .env
# export
# endif

# Color output
CYAN := \033[36m
GREEN := \033[32m
RED := \033[31m
RESET := \033[0m

# Database configuration
DB_HOST ?= localhost
DB_PORT ?= 5432
DB_USER ?= timely
DB_PASSWORD ?= root123
DB_NAME ?= timely_db
DB_SSLMODE ?= disable

# Build database connection string
GOOSE_DBSTRING ?= "host=$(DB_HOST) port=$(DB_PORT) user=$(DB_USER) password=$(DB_PASSWORD) dbname=$(DB_NAME) sslmode=$(DB_SSLMODE)"

help: ## Show this help message
	@echo "$(CYAN)Available migration targets:$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(RESET) %s\n", $$1, $$2}'

migrate-up: ## Run all pending migrations (UP)
	@echo "$(CYAN)Running pending migrations...$(RESET)"
	@go run cmd/main.go

migrate-down: ## Rollback the last migration (DOWN)
	@echo "$(CYAN)Rolling back the last migration...$(RESET)"
	@goose -dir migrations postgres $(GOOSE_DBSTRING) down
	@echo "$(GREEN)✓ Last migration rolled back$(RESET)"

migrate-status: ## Show current migration status
	@echo "$(CYAN)Checking migration status...$(RESET)"
	@goose -dir migrations postgres $(GOOSE_DBSTRING) status

migrate-create: ## Create a new migration file. Usage: make migrate-create NAME=your_migration_name
	@if [ -z "$(NAME)" ]; then \
		echo "$(RED)Error: Migration name not provided$(RESET)"; \
		echo "Usage: make migrate-create NAME=your_migration_name"; \
		exit 1; \
	fi
	@echo "$(CYAN)Creating migration: $(NAME)$(RESET)"
	@goose -dir migrations create $(NAME) sql
	@echo "$(GREEN)✓ Migration created in migrations/ directory$(RESET)"

migrate-reset: ## Reset database (run all migrations from scratch). WARNING: This will drop all data!
	@echo "$(RED)WARNING: This will reset all database migrations and drop all data!$(RESET)"
	@read -p "Are you sure? (y/N) " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo "$(CYAN)Resetting migrations...$(RESET)"; \
		goose -dir migrations postgres $(GOOSE_DBSTRING) reset; \
		echo "$(GREEN)✓ Migrations reset complete$(RESET)"; \
		echo "$(CYAN)Running migrations again...$(RESET)"; \
		make migrate-up; \
	else \
		echo "$(RED)Reset cancelled$(RESET)"; \
		exit 1; \
	fi

migrate-fix: ## Mark a migration as applied in the database (use with caution)
	@if [ -z "$(VERSION)" ]; then \
		echo "$(RED)Error: Version not provided$(RESET)"; \
		echo "Usage: make migrate-fix VERSION=20260617100000"; \
		exit 1; \
	fi
	@echo "$(CYAN)Marking migration $(VERSION) as applied...$(RESET)"
	@goose -dir migrations postgres $(GOOSE_DBSTRING) fix $(VERSION)
	@echo "$(GREEN)✓ Migration $(VERSION) marked as applied$(RESET)"

migrate-seed: ## Apply mock seed data from migrations/seeds
	@echo "$(CYAN)Applying seed data...$(RESET)"
	@goose -dir migrations/seeds postgres $(GOOSE_DBSTRING) up
	@echo "$(GREEN)✓ Seed data applied$(RESET)"

migrate-unseed: ## Roll back last seed migration from migrations/seeds
	@echo "$(CYAN)Rolling back seed data...$(RESET)"
	@goose -dir migrations/seeds postgres $(GOOSE_DBSTRING) down
	@echo "$(GREEN)✓ Seed data rolled back$(RESET)"

install-goose: ## Install goose CLI tool
	@echo "$(CYAN)Installing goose CLI...$(RESET)"
	@go install github.com/pressly/goose/v3/cmd/goose@latest
	@echo "$(GREEN)✓ Goose CLI installed$(RESET)"
