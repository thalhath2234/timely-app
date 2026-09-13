# Timely monorepo task runner.
# Run `make help` to list targets. Every target here is the canonical way to
# run/build/test an app; the per-app package.json scripts are implementation
# details that this file calls into.

SHELL := /bin/bash
.DEFAULT_GOAL := help

API    := apps/api
WEB    := apps/web
MOBILE := apps/mobile

CYAN  := $(shell printf '\033[36m')
GREEN := $(shell printf '\033[32m')
RED   := $(shell printf '\033[31m')
RESET := $(shell printf '\033[0m')

# Load the API's .env (DB_* etc.) so goose targets use the same credentials as
# the running server. Missing file is fine.
-include $(API)/.env

# Database configuration (overridable: make migrate-status DB_HOST=...)
DB_HOST     ?= localhost
DB_PORT     ?= 5432
DB_USER     ?= timely
DB_PASSWORD ?= root123
DB_NAME     ?= timely_db
DB_SSLMODE  ?= disable
GOOSE_DBSTRING ?= "host=$(DB_HOST) port=$(DB_PORT) user=$(DB_USER) password=$(DB_PASSWORD) dbname=$(DB_NAME) sslmode=$(DB_SSLMODE)"
GOOSE_MIGRATIONS := goose -dir $(API)/migrations postgres $(GOOSE_DBSTRING)
GOOSE_SEEDS      := goose -dir $(API)/migrations/seeds postgres $(GOOSE_DBSTRING)

.PHONY: help setup install tools install-air install-goose \
        dev dev-api dev-web dev-mobile dev-desktop launch-electron \
        build build-api build-web build-desktop dist-desktop build-apk apk-status \
        lint lint-api lint-web typecheck typecheck-web typecheck-mobile test test-api check \
        migrate-up migrate-down migrate-status migrate-create migrate-reset migrate-fix migrate-seed migrate-unseed \
        reset-password clean

##@ General

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make $(CYAN)<target>$(RESET)\n"} \
	  /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-18s$(RESET) %s\n", $$1, $$2 } \
	  /^##@/ { printf "\n$(CYAN)%s$(RESET)\n", substr($$0, 5) }' $(MAKEFILE_LIST)

setup: install tools ## First-time setup: install JS deps, Go modules, and CLI tools
	@for app in $(API) $(WEB); do \
	  if [ ! -f $$app/.env ] && [ -f $$app/.env.example ]; then cp $$app/.env.example $$app/.env; echo "created $$app/.env from example"; fi; \
	done
	@echo "$(GREEN)✓ Setup complete. Set EXPO_PUBLIC_API_URL in $(MOBILE)/.env before running the mobile app.$(RESET)"

install: ## Install workspace JS dependencies (pnpm) and Go modules
	@pnpm install
	@cd $(API) && go mod download

tools: install-air install-goose ## Install Go CLI tools (air, goose)

install-air: ## Install the air live-reload CLI
	@go install github.com/air-verse/air@latest

install-goose: ## Install the goose migration CLI
	@go install github.com/pressly/goose/v3/cmd/goose@latest

##@ Develop

dev: ## Run API (:8080) and web (:4001) together with live reload
	@$(MAKE) -j2 --no-print-directory dev-api dev-web

dev-api: ## Run the Go API with live reload (air)
	@cd $(API) && air

dev-web: ## Run the Next.js dev server on :4001
	@pnpm --filter @timely/web dev

dev-mobile: ## Start the Expo dev server (Metro)
	@pnpm --filter @timely/mobile start

dev-desktop: ## Run API, Next.js, and the Electron desktop shell
	@$(MAKE) -j3 --no-print-directory dev-api dev-web launch-electron

launch-electron:
	@pnpm --filter @timely/web electron:compile
	@pnpm --filter @timely/web electron:open

##@ Build

build: build-api build-web ## Build API binary and web app

build-api: ## Compile the API to apps/api/bin/timely-api
	@cd $(API) && go build -o bin/timely-api ./cmd
	@echo "$(GREEN)✓ $(API)/bin/timely-api$(RESET)"

build-web: ## Production build of the Next.js app
	@pnpm --filter @timely/web build

build-desktop: ## Package an unpacked Electron app for this OS (release/<platform>-unpacked)
	@pnpm --filter @timely/web electron:pack

dist-desktop: ## Build a distributable Electron installer for this OS (AppImage / dmg / nsis)
	@pnpm --filter @timely/web electron:dist

build-apk: ## Build the Android release APK (memory-capped, detached). Usage: make build-apk [API_URL=https://...]
	@scripts/build-apk.sh $(API_URL)

apk-status: ## Show status of the detached APK build
	@systemctl --user status timely-apk-build.service --no-pager || true
	@tail -n 20 /tmp/timely-apk-build.log 2>/dev/null || true

##@ Quality

check: lint typecheck test ## Run all lint, typecheck and tests

lint: lint-api lint-web ## Lint all apps

lint-api: ## go vet the API
	@cd $(API) && go vet ./...

lint-web: ## ESLint the web app
	@pnpm --filter @timely/web lint

typecheck: typecheck-web typecheck-mobile ## Type-check web and mobile

typecheck-web: ## tsc --noEmit for web
	@pnpm --filter @timely/web typecheck

typecheck-mobile: ## tsc --noEmit for mobile
	@pnpm --filter @timely/mobile typecheck

test: test-api ## Run all tests

test-api: ## go test the API
	@cd $(API) && go test ./...

##@ Database (apps/api/migrations)

migrate-up: ## Run all pending migrations (via the API's startup migrator)
	@echo "$(CYAN)Running pending migrations...$(RESET)"
	@cd $(API) && go run cmd/main.go

migrate-down: ## Roll back the last migration
	@$(GOOSE_MIGRATIONS) down

migrate-status: ## Show migration status
	@$(GOOSE_MIGRATIONS) status

migrate-create: ## Create a new SQL migration. Usage: make migrate-create NAME=add_thing
	@if [ -z "$(NAME)" ]; then echo "$(RED)Usage: make migrate-create NAME=your_migration_name$(RESET)"; exit 1; fi
	@goose -dir $(API)/migrations create $(NAME) sql

migrate-reset: ## Reset database and re-run all migrations. WARNING: drops all data
	@echo "$(RED)WARNING: This will drop all data in $(DB_NAME)!$(RESET)"
	@read -p "Are you sure? (y/N) " -n 1 -r; echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then $(GOOSE_MIGRATIONS) reset && $(MAKE) --no-print-directory migrate-up; else echo "cancelled"; exit 1; fi

migrate-fix: ## Mark a migration version as applied. Usage: make migrate-fix VERSION=20260617100000
	@if [ -z "$(VERSION)" ]; then echo "$(RED)Usage: make migrate-fix VERSION=20260617100000$(RESET)"; exit 1; fi
	@$(GOOSE_MIGRATIONS) fix $(VERSION)

migrate-seed: ## Apply mock seed data from migrations/seeds
	@$(GOOSE_SEEDS) up

migrate-unseed: ## Roll back the last seed migration
	@$(GOOSE_SEEDS) down

##@ Admin

reset-password: ## Reset a user's password. Usage: make reset-password EMAIL=a@b.c PASSWORD=secret
	@if [ -z "$(EMAIL)" ] || [ -z "$(PASSWORD)" ]; then echo "$(RED)Usage: make reset-password EMAIL=user@example.com PASSWORD=new-password$(RESET)"; exit 1; fi
	@cd $(API) && go run ./scripts/reset_password.go -email "$(EMAIL)" -password "$(PASSWORD)"

clean: ## Remove build outputs (keeps node_modules and the native android/ project)
	@rm -rf $(API)/tmp $(API)/bin/timely-api $(WEB)/.next $(WEB)/out $(WEB)/tmp $(WEB)/dist-electron $(WEB)/release $(WEB)/.electron-next $(MOBILE)/.expo $(MOBILE)/dist
	@echo "$(GREEN)✓ cleaned$(RESET)"
