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

# Load the root .env (DB_* etc.) so goose targets use the same credentials as
# the running server. Missing file is fine.
-include .env

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

.PHONY: help setup setup-env install tools install-air install-goose \
        dev dev-api dev-web dev-mobile dev-mobile-device dev-desktop launch-electron \
        dev-worktree dev-worktree-api dev-worktree-web \
        build build-api build-web build-desktop dist-desktop stage-desktop dev-desktop-hosted build-apk install-apk apk-status \
        emu-start emu-stop emu-status \
        lint lint-api lint-web typecheck typecheck-web typecheck-mobile test test-api check \
        migrate-up migrate-down migrate-status migrate-create migrate-reset migrate-fix migrate-seed migrate-unseed \
        reset-password clean

##@ General

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make $(CYAN)<target>$(RESET)\n"} \
	  /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-18s$(RESET) %s\n", $$1, $$2 } \
	  /^##@/ { printf "\n$(CYAN)%s$(RESET)\n", substr($$0, 5) }' $(MAKEFILE_LIST)

setup: install tools setup-env ## First-time setup: install dependencies, tools, and the local .env
	@echo "$(GREEN)✓ Setup complete. Configuration for all apps: .env$(RESET)"

setup-env: ## Copy/create the ignored root .env for this checkout or worktree
	@scripts/setup-env.sh

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

dev-worktree: ## Run API (:8081) and web (:4002) together in this worktree
	@$(MAKE) -j2 --no-print-directory dev-worktree-api dev-worktree-web

dev-worktree-api: ## Run the Go API on :8081 with live reload
	@cd $(API) && API_PORT=8081 air

dev-worktree-web: ## Run Next.js on :4002 against the worktree API
	@API_ORIGIN=http://localhost:8081 pnpm --filter @timely/web exec next dev -p 4002

.PHONY: audit-web
AUDIT_PORT ?= 4050
audit-web: ## Run an isolated web server for screenshot audits (AUDIT_PORT=4050)
	@pnpm --filter @timely/web exec next dev --webpack -p $(AUDIT_PORT)

.PHONY: audit-desktop
AUDIT_ELECTRON_BIN ?= $(CURDIR)/$(WEB)/node_modules/electron/dist/electron
audit-desktop: ## Run Electron under Xvfb for desktop audit captures (Linux)
	@pnpm --filter @timely/web electron:compile
	@cd $(WEB) && env -u ELECTRON_RUN_AS_NODE ELECTRON_RENDERER_URL=http://localhost:$(AUDIT_PORT) xvfb-run -a -s '-screen 0 1600x1000x24' $(AUDIT_ELECTRON_BIN) --no-sandbox --ozone-platform=x11 --remote-debugging-port=4061 --user-data-dir=/tmp/timely-design-audit-electron .

.PHONY: audit-index
audit-index: ## Rebuild and validate the portable screenshot gallery
	@python audit/scripts/build_index.py
	@python audit/scripts/build_inventory.py

MOBILE_METRO_FLAGS ?=

dev-mobile: setup-env ## Start the Expo dev server (Metro on :8082; leave :8081 for the worktree API)
	@pnpm --filter @timely/mobile exec expo start --lan --port 8082 --go $(MOBILE_METRO_FLAGS)

dev-mobile-device: setup-env ## Metro + Expo Go on a USB phone (adb reverse :8082)
	@ANDROID_HOME=$${ANDROID_HOME:-$${ANDROID_SDK_ROOT:-/home/thalhath/.local/android-sdk}}; \
	export ANDROID_HOME; \
	export ANDROID_SDK_ROOT="$$ANDROID_HOME"; \
	export PATH="$$ANDROID_HOME/platform-tools:$$PATH"; \
	ADB="$$ANDROID_HOME/platform-tools/adb"; \
	if [ ! -x "$$ADB" ]; then echo "adb not found at $$ADB (set ANDROID_HOME)" >&2; exit 1; fi; \
	if ! $$ADB devices | awk 'NR>1 && $$2=="device"{found=1} END{exit !found}'; then \
	  echo "No authorized Android device found. Plug in the phone, enable USB debugging, and accept the RSA prompt." >&2; \
	  $$ADB devices -l >&2 || true; \
	  exit 1; \
	fi; \
	$$ADB reverse tcp:8082 tcp:8082; \
	$$ADB reverse --list; \
	echo "Open Expo Go on the phone (not the Timely icon) after Metro is up."; \
	ANDROID_HOME="$$ANDROID_HOME" ANDROID_SDK_ROOT="$$ANDROID_HOME" PATH="$$ANDROID_HOME/platform-tools:$$PATH" \
	NODE_OPTIONS='--dns-result-order=ipv4first' \
	pnpm --filter @timely/mobile exec expo start --localhost --port 8082 --go --android

dev-desktop: ## Run API, Next.js, and the Electron desktop shell
	@$(MAKE) -j3 --no-print-directory dev-api dev-web launch-electron

launch-electron:
	@pnpm --filter @timely/web electron:compile
	@pnpm --filter @timely/web electron:open

##@ Build

build: build-api build-web ## Build API binary and web app

build-api: ## Compile the API to apps/api/bin/timely-api
	@cd $(API) && CGO_ENABLED=0 go build -trimpath -ldflags "-X main.version=$$(node -p "require('../web/package.json').version")" -o bin/timely-api ./cmd
	@echo "$(GREEN)✓ $(API)/bin/timely-api$(RESET)"

build-web: ## Production build of the Next.js app
	@pnpm --filter @timely/web build

build-desktop: ## Package an unpacked Electron app for this OS, with the API and Postgres sidecars (release/<platform>-unpacked)
	@pnpm --filter @timely/web electron:pack

dist-desktop: ## Build a distributable Electron installer for this OS (AppImage / dmg / nsis). TIMELY_TARGETS=linux-x64,darwin-arm64 for several
	@pnpm --filter @timely/web electron:dist

.PHONY: stage-desktop
stage-desktop: ## Cross-compile the API and fetch Postgres 17 for the desktop bundle (TIMELY_TARGETS=... for other OSes)
	@node $(WEB)/electron/stage-api.mjs
	@node $(WEB)/electron/stage-postgres.mjs

.PHONY: dev-desktop-hosted
dev-desktop-hosted: stage-desktop ## Run the Electron shell in hosted mode (its own Postgres + API) against a throwaway user-data dir
	@pnpm --filter @timely/web electron:compile
	@pnpm --filter @timely/web electron:hosted

build-apk: ## Build the Android release APK (memory-capped, detached). The phone pairs with a server at runtime; API_URL=... only pre-fills a dev URL
	@scripts/build-apk.sh $(if $(API_URL),--api-url "$(API_URL)")

install-apk: ## Build the Android release APK and install it on a connected phone. Optional API_URL=... as for build-apk
	@scripts/install-apk.sh $(if $(API_URL),--api-url "$(API_URL)")

apk-status: ## Show status of the detached APK build
	@systemctl --user status timely-apk-build.service --no-pager || true
	@tail -n 20 /tmp/timely-apk-build.log 2>/dev/null || true

emu-start: ## Start the Android emulator under a 3G memory cap (1536 MB guest)
	@scripts/start-emulator.sh

emu-stop: ## Stop the memory-capped Android emulator
	@scripts/stop-emulator.sh

emu-status: ## Show emulator cgroup memory, adb, and log
	@scripts/emulator-status.sh

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

test: test-api test-sheet-formulas test-mobile-assistant test-mobile-offline test-mobile-server-config test-electron-guards test-electron-supervisor test-desktop-instance ## Run all tests

test-api: ## go test the API
	@cd $(API) && go test ./...

##@ Database (apps/api/migrations)

migrate-up: ## Run all pending migrations (via the API's startup migrator)
	@echo "$(CYAN)Running pending migrations...$(RESET)"
	@cd $(API) && go run ./cmd

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
	@rm -rf $(API)/tmp $(API)/bin/timely-api $(WEB)/.next $(WEB)/out $(WEB)/tmp $(WEB)/dist-electron $(WEB)/release $(WEB)/.electron-next $(WEB)/.electron-api $(WEB)/.electron-postgres $(MOBILE)/.expo $(MOBILE)/dist
	@echo "$(GREEN)✓ cleaned$(RESET)"

.PHONY: format-api
format-api: ## Format Go source
	@git ls-files -m -o --exclude-standard -- 'apps/api/*.go' 'apps/api/**/*.go' | xargs -r gofmt -w

.PHONY: test-providers-live
test-providers-live: ## Call real agent provider APIs (tool round trip + image) for every TIMELY_LIVE_KEY_<ID> set (e.g. TIMELY_LIVE_KEY_OPENROUTER)
	@cd $(API) && TIMELY_LIVE_PROVIDERS=1 go test ./internal/features/provider -run TestLiveProviders -count=1 -v

.PHONY: test-chat-integration lint-chat
test-chat-integration: ## Test agent transactions and approvals in an isolated temporary PostgreSQL schema
	@cd $(API) && CHAT_TEST_ENV="$(CURDIR)/.env" go test ./internal/features/chat ./internal/features/sheet ./internal/features/provider ./internal/features/search ./cmd -run TestIntegration -count=1

lint-chat: ## Lint the chat UI and Electron integration
	@pnpm --filter @timely/web exec eslint app/_components/chat app/_store/chatStore.ts app/utils/api/chat.ts app/utils/hooks/chat.ts "app/(pages)/(nav_pages)/chat" electron/main.ts electron/preload.ts

.PHONY: audit-chat
audit-chat: ## Check chat layouts and overlay in Chromium against mocked API responses (web on :4002)
	@node scripts/audit-chat.cjs

.PHONY: format-chat install-browser
format-chat: ## Format chat UI and its browser audit
	@pnpm exec prettier --write apps/web/app/_components/chat apps/web/app/_store/chatStore.ts apps/web/app/utils/api/chat.ts apps/web/app/utils/hooks/chat.ts "apps/web/app/(pages)/(nav_pages)/chat/page.tsx" scripts/audit-chat.cjs

install-browser: ## Install Chromium for browser checks
	@pnpm exec playwright install chromium

.PHONY: test-sheet-formulas lint-sheet-formulas format-sheet-formulas
test-sheet-formulas: ## Test web and mobile sheet formula evaluation, range editing and grid growth
	@node --experimental-strip-types --test scripts/sheet-formulas.test.mjs scripts/sheet-grid-grow.test.mjs
lint-sheet-formulas: ## Lint the web sheet formula evaluator
	@pnpm --filter @timely/web exec eslint app/utils/sheetFormula.ts
format-sheet-formulas: ## Format sheet formula helpers and tests
	@pnpm exec prettier --write apps/web/app/utils/sheetFormula.ts apps/mobile/lib/sheetFormula.ts packages/contract/src/sheetFormulaInput.ts scripts/sheet-formulas.test.mjs apps/mobile/lib/sheetGrow.ts scripts/sheet-grid-grow.test.mjs

.PHONY: test-mobile-assistant format-mobile-assistant
test-mobile-assistant: ## Test mobile assistant context and notification routing
	@node --experimental-strip-types --test scripts/mobile-assistant.test.mjs
format-mobile-assistant: ## Format mobile assistant and its screen context integration
	@pnpm exec prettier --write apps/mobile/components/chat apps/mobile/lib/chat apps/mobile/lib/api/chat.ts apps/mobile/lib/notificationRoute.ts scripts/mobile-assistant.test.mjs scripts/audit-mobile-assistant.mjs

.PHONY: audit-mobile-receipt audit-mobile-assistant
audit-mobile-receipt: ## Preview the mobile receipt flow on :4002 with fixture APIs (optional AUDIT_RECEIPT_IMAGE)
	@node scripts/audit-mobile-receipt.mjs

audit-mobile-assistant: ## Check the mobile assistant screens in Chromium with fixture APIs (web on :4002; AUDIT_CHECK=0 to only serve)
	@AUDIT_CHECK=$${AUDIT_CHECK-1} node scripts/audit-mobile-assistant.mjs

.PHONY: audit-qa-api audit-dependencies check-mobile-deps
audit-qa-api: ## Run the 2026-10-01 live API audit against localhost:8081 (creates QA accounts)
	@node docs/qa/2026-10-01/api-audit.mjs

audit-dependencies: ## Audit production JavaScript dependencies
	@pnpm audit --prod --json

check-mobile-deps: ## Check installed mobile packages against the Expo SDK
	@pnpm --filter @timely/mobile exec expo install --check

.PHONY: test-portability-integration audit-api-dependencies
test-portability-integration: ## Test PostgreSQL backup restore inside a rolled-back transaction
	@cd $(API) && TIMELY_TEST_POSTGRES=1 go test ./internal/features/portability -run RestorePostgres -count=1

audit-api-dependencies: ## Check reachable Go dependency vulnerabilities
	@cd $(API) && go run golang.org/x/vuln/cmd/govulncheck@latest ./...

.PHONY: audit-mobile-offline format-qa check-qa test-mobile-offline test-electron-guards
audit-mobile-offline: ## Check the mobile offline mutation path with the app's own QueryClient and queue configuration
	@node --experimental-strip-types docs/qa/2026-10-01/offline-mutation-probe.mjs

test-mobile-offline: ## Test the mobile offline queue: durable enqueue, restart, account scope, replay
	@node --experimental-strip-types --test scripts/mobile-offline-queue.test.mjs

test-electron-guards: ## Test the desktop shell's window-open origin policy
	@node --experimental-strip-types --test scripts/electron-guards.test.mjs

.PHONY: test-electron-supervisor test-mobile-server-config test-desktop-instance
test-electron-supervisor: ## Test the desktop supervisor: config/secrets, ports, Tailscale detection, backoff, stale pid
	@node --experimental-strip-types --test scripts/electron-supervisor.test.mjs

test-mobile-server-config: ## Test mobile pairing: QR payload parsing, server order, reachability probe
	@node --experimental-strip-types --test scripts/mobile-server-config.test.mjs

test-desktop-instance: ## Test the web Settings → Server helpers (pairing payload, status copy)
	@node --experimental-strip-types --test scripts/desktop-instance.test.mjs

format-qa: ## Format the 2026-10-01 QA scripts and evidence
	@pnpm exec prettier --write 'docs/qa/2026-10-01*/**/*.{mjs,json,md}'

check-qa: ## Check QA script syntax and artifact formatting
	@node --check docs/qa/2026-10-01/api-audit.mjs
	@node --check docs/qa/2026-10-01/offline-mutation-probe.mjs
	@pnpm exec prettier --check 'docs/qa/2026-10-01*/**/*.{mjs,json,md}'
