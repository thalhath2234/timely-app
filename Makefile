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
        dev dev-api dev-web film-studio film-render film-render-loops film-render-stills dev-mobile dev-mobile-web dev-mobile-device dev-desktop launch-electron \
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

install: ## Install workspace JS dependencies (pnpm), Go modules and the agent runtime (skipped with a notice when uv is missing)
	@pnpm install
	@cd $(API) && go mod download
	@$(MAKE) --no-print-directory agent-install

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

film-studio: ## Open the landing-page film (Remotion Studio) for editing
	@pnpm --filter @timely/web film:studio

film-render: ## Render the landing-page film to apps/web/out/timely-film.mp4
	@pnpm --filter @timely/web film:render

film-render-loops: ## Render the empty-state loops to apps/mobile/assets/loops/*.webp (ONLY=<id> for one; needs ffmpeg with libwebp)
	@pnpm --filter @timely/web film:render-loops $(if $(ONLY),--only $(ONLY))

film-render-stills: ## Render the help-centre stills to apps/web/public/help/film/*.webp (needs ffmpeg with libwebp)
	@pnpm --filter @timely/web film:render-stills

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

dev-mobile-web: setup-env ## Run the phone app in a browser (Metro on :8082) against the worktree API on :8081
	@EXPO_PUBLIC_API_URL=http://localhost:8081 pnpm --filter @timely/mobile exec expo start --web --port 8082

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

build-desktop: ## Package an unpacked "Timely Dev" app for this OS, with the API and Postgres sidecars (release/<platform>-unpacked); runs next to an installed release
	@pnpm --filter @timely/web electron:pack

dist-desktop: ## Build a "Timely Dev" installer for this OS and architecture (AppImage / dmg / nsis); TIMELY_RELEASE=1 for the release app. The agent runtime stages only for the host, so other targets build on their own runner
	@pnpm --filter @timely/web electron:dist

.PHONY: stage-desktop
stage-desktop: ## Cross-compile the API, fetch Postgres 17 and stage the agent runtime for the desktop bundle (TIMELY_TARGETS=... stages the API and Postgres for those targets; the agent runtime always stages for this host only)
	@node $(WEB)/electron/stage-api.mjs
	@node $(WEB)/electron/stage-postgres.mjs
	@node $(WEB)/electron/stage-agent.mjs --host

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

lint: lint-api lint-web lint-agent ## Lint all apps

lint-api: ## go vet the API
	@cd $(API) && go vet ./...

lint-web: ## ESLint the web app
	@pnpm --filter @timely/web lint

typecheck: typecheck-web typecheck-mobile ## Type-check web and mobile

typecheck-web: ## tsc --noEmit for web
	@pnpm --filter @timely/web typecheck

typecheck-mobile: ## tsc --noEmit for mobile
	@pnpm --filter @timely/mobile typecheck

test: test-api test-markdown-parity test-change-review test-doc-checklist test-sheet-formulas test-work-status test-help-me-write test-block-turn test-inbox test-starter-labels test-view-search test-smart-search test-view-language test-dashboard test-genui test-mobile-live-block test-mobile-clearable test-mobile-plain-text test-mobile-next-free-slot test-mobile-picker-seed test-design-tokens test-mobile-doc-jev test-mobile-file-templates test-mobile-sheet-freeze test-mobile-dashboard-reorder test-mobile-task-views test-mobile-assistant test-mobile-offline test-mobile-server-config test-mobile-keyboard-taps test-mobile-scrollbars test-mobile-live-activity test-mobile-push test-mobile-widgets test-electron-guards test-electron-supervisor test-desktop-instance test-web-api-proxy test-chat-stream test-project-delete test-bulk-edit test-autosave test-client-calls test-mobile-event-occurrence test-calendar-occurrence-done test-mobile-meeting-url test-mobile-back-fallback test-bots test-agent test-agent-chat test-agent-learning test-stage-agent ## Run all tests

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
	@node $(WEB)/electron/stage-agent.mjs --clean
	@echo "$(GREEN)✓ cleaned$(RESET)"

.PHONY: format-api
format-api: ## Format Go source
	@git ls-files -m -o --exclude-standard -- 'apps/api/*.go' 'apps/api/**/*.go' | xargs -r gofmt -w

.PHONY: test-providers-live
test-providers-live: ## Call real agent provider APIs (tool round trip + image) for every TIMELY_LIVE_KEY_<ID> set (e.g. TIMELY_LIVE_KEY_OPENROUTER)
	@cd $(API) && TIMELY_LIVE_PROVIDERS=1 go test ./internal/features/provider -run TestLiveProviders -count=1 -v

.PHONY: test-bots-ai-live
test-bots-ai-live: ## Run bots' AI judge, lesson, knowledge, brief, pass and shared-alert cases against Anthropic's small model (TIMELY_LIVE_KEY_ANTHROPIC exported or in .env; TIMELY_LIVE_BOTS_LOG=<file> also appends the answers there)
	@cd $(API) && CHAT_TEST_ENV="$(CURDIR)/.env" TIMELY_LIVE_BOTS=1 go test ./cmd -run TestLiveBotAI -count=1 -v

.PHONY: test-chat-integration lint-chat
test-chat-integration: ## Test agent transactions and approvals in an isolated temporary PostgreSQL schema
	@cd $(API) && CHAT_TEST_ENV="$(CURDIR)/.env" go test ./internal/jobs ./internal/realtime ./internal/features/chat ./internal/features/sheet ./internal/features/provider ./internal/features/search ./internal/features/workspace ./internal/features/placement ./internal/features/task ./internal/features/notify ./internal/features/schedule ./internal/features/suggest ./internal/features/bots/... ./internal/features/portability ./internal/features/learning ./internal/features/auth ./cmd -run TestIntegration -count=1 -timeout 30m

.PHONY: mcp-60day
mcp-60day: ## Play 60 days of one person through MCP against a running API and check reads against a ledger (TIMELY_API, default :8081; ARGS=-seed N -out DIR)
	@cd $(API) && TIMELY_API=$${TIMELY_API:-http://localhost:8081} go run scripts/mcp_60day.go $(ARGS)

.PHONY: mcp-read-only-check
mcp-read-only-check: ## Run MCP parity and fail when a tool annotated read-only changes a table (DB_SCHEMA=<the API's schema>, required; TIMELY_API, default :8081)
	@cd $(API) && TIMELY_API=$${TIMELY_API:-http://localhost:8081} \
		DB_HOST='$(DB_HOST)' DB_PORT='$(DB_PORT)' DB_USER='$(DB_USER)' DB_PASSWORD='$(DB_PASSWORD)' DB_NAME='$(DB_NAME)' DB_SSLMODE='$(DB_SSLMODE)' \
		go run scripts/mcp_parity.go -read-only

.PHONY: verify-agent-runs
verify-agent-runs: ## Model-check Agent run claiming, leases, Stop and Retry with TLA+ (ARGS=--mutants or --resync; see .agents/skills/verify-agent-runs)
	@.agents/skills/verify-agent-runs/run.sh $(ARGS)

.PHONY: pstack-sync
pstack-sync: ## Re-copy Cursor's pstack skills into .agents/pstack for cloud sessions (PSTACK_REF=<branch or tag>, default main)
	@scripts/sync-pstack.sh

lint-chat: ## Lint the chat UI and Electron integration
	@pnpm --filter @timely/web exec eslint app/_components/chat app/_store/chatStore.ts app/utils/api/chat.ts app/utils/hooks/chat.ts "app/(pages)/(nav_pages)/chat" electron/main.ts electron/preload.ts

.PHONY: audit-chat
audit-chat: ## Check chat layouts and overlay in Chromium against mocked API responses (web on :4002)
	@node scripts/audit-chat.cjs

.PHONY: format-chat check-format-chat install-browser
CHAT_FORMAT_PATHS = apps/web/app/_components/chat apps/web/app/_store/chatStore.ts apps/web/app/utils/api/chat.ts apps/web/app/utils/hooks/chat.ts "apps/web/app/(pages)/(nav_pages)/chat/page.tsx" scripts/audit-chat.cjs
format-chat: ## Format chat UI and its browser audit
	@pnpm exec prettier --write $(CHAT_FORMAT_PATHS)
check-format-chat: ## Check that the chat UI and its browser audit are formatted (format-chat fixes it)
	@pnpm exec prettier --check $(CHAT_FORMAT_PATHS)

install-browser: ## Install Chromium for browser checks
	@pnpm exec playwright install chromium

.PHONY: test-sheet-formulas lint-sheet-formulas format-sheet-formulas gen-sheet-builtins gen-sheet-engine
gen-sheet-engine: ## Bundle the shared formula engine for the API (agents read worked-out sheet values with it)
	@node scripts/gen-sheet-engine.mjs
gen-sheet-builtins: ## Write the built-in sheet templates as JSON for the API (agents create them from it)
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs scripts/gen-sheet-builtins.mjs
test-sheet-formulas: ## Test the shared sheet logic (formulas, ranges, cells, CSV) and grid growth
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs --test scripts/sheet-formulas.test.mjs scripts/sheet-refs.test.mjs scripts/sheet-range.test.mjs scripts/sheet-cell-csv.test.mjs scripts/sheet-template-display.test.mjs scripts/sheet-ops.test.mjs scripts/sheet-grid-grow.test.mjs
lint-sheet-formulas: ## Lint the shared sheet logic in packages/contract
	@apps/web/node_modules/.bin/eslint -c apps/web/eslint.config.mjs packages/contract/src/sheetFormula.ts packages/contract/src/sheetRange.ts packages/contract/src/sheetCell.ts packages/contract/src/sheetCsv.ts packages/contract/src/sheetTypes.ts packages/contract/src/sheetDisplay.ts packages/contract/src/sheetTemplates.ts packages/contract/src/sheetRefs.ts packages/contract/src/sheetValues.ts packages/contract/src/sheetFunctions.ts packages/contract/src/sheetOps.ts packages/contract/src/sheetEngine.ts
format-sheet-formulas: ## Format shared sheet logic and tests
	@pnpm exec prettier --write packages/contract/src/sheetFormula.ts packages/contract/src/sheetFormulaInput.ts packages/contract/src/sheetRange.ts packages/contract/src/sheetCell.ts packages/contract/src/sheetCsv.ts packages/contract/src/sheetTypes.ts scripts/sheet-formulas.test.mjs scripts/sheet-range.test.mjs scripts/sheet-cell-csv.test.mjs apps/mobile/lib/sheetGrow.ts scripts/sheet-grid-grow.test.mjs

.PHONY: test-markdown-parity
test-markdown-parity: ## Test that the web/mobile Markdown importer reads the API's export back into the same doc
	@node --experimental-strip-types --test scripts/markdown-parity.test.mjs

.PHONY: test-autosave
test-autosave: ## Test the shared autosave queue: a change the server refuses is dropped and later edits still save
	@node --experimental-strip-types --test scripts/autosave-queue.test.mjs

.PHONY: test-client-calls
test-client-calls: ## Test when the apps ask for searches and suggestions that cost a model call: settled typing, clipped queries, rebuild polling
	@node --experimental-strip-types --test scripts/client-calls.test.mjs

.PHONY: test-bulk-edit
test-bulk-edit: ## Test that bulk task edits undo per task and that Set label adds the label by name per workspace
	@node --experimental-strip-types --test scripts/bulk-edit.test.mjs

.PHONY: test-change-review
test-change-review: ## Test how an Agent proposal is grouped for review: one item per sheet, tasks together, docs with real tick boxes
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs --test scripts/change-review.test.mjs

.PHONY: test-bots
test-bots: ## Test the Bots board rules, card lines, starters and limits shared by web and phone
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs --test scripts/bots.test.mjs

.PHONY: test-doc-checklist
test-doc-checklist: ## Test which doc checklist items are offered as tasks, the task name and description they get, and when a doc's suggestions are read again
	@node --experimental-strip-types --test scripts/doc-checklist.test.mjs

.PHONY: test-work-status
test-work-status: ## Test the shared Overdue and Unscheduled work status logic
	@node --experimental-strip-types --test scripts/work-status.test.mjs

.PHONY: test-help-me-write
test-help-me-write: ## Test the shared Help me write starters, how answers become editor content, and what Replace may take on web and phone
	@node --experimental-strip-types --test scripts/help-me-write.test.mjs scripts/help-me-write-range.test.mjs

.PHONY: test-block-turn
test-block-turn: ## Test the doc block menu's Turn into on web and phone: which blocks it offers and what each kind makes of them
	@node --experimental-strip-types --test scripts/block-turn.test.mjs

.PHONY: test-inbox
test-inbox: ## Test the shared Inbox order (Up next, skips) and waiting-time labels
	@node --experimental-strip-types --test scripts/inbox.test.mjs

.PHONY: test-starter-labels
test-starter-labels: ## Test how onboarding splits starter labels across the workspaces it creates
	@node --experimental-strip-types --test scripts/starter-labels.test.mjs

.PHONY: test-view-search
test-view-search: ## Test how search finds a saved task view by its name ("show my deadline")
	@node --experimental-strip-types --test scripts/view-search.test.mjs

.PHONY: test-smart-search
test-smart-search: ## Test what smart search offers to make, how long a Related list is kept, and import line kinds the apps do not know
	@node --experimental-strip-types --test scripts/smart-search.test.mjs

.PHONY: test-view-language
test-view-language: ## Test how plain words become a task view ("overdue bugs in Home by project"), the shared filter, sort and group engine, and the rule builder
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs --test scripts/view-language.test.mjs scripts/task-query.test.mjs scripts/rule-builder.test.mjs

.PHONY: test-project-delete
test-project-delete: ## Test the confirm that names the tasks a project delete takes with it
	@node --experimental-strip-types --test scripts/project-delete.test.mjs

.PHONY: test-genui gen-genui-prompt gen-board-check
test-genui: ## Test reply and described cards: the OpenUI prompts, their examples, splitting replies and @Data
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs --test scripts/genui.test.mjs
gen-genui-prompt: ## Write the reply- and described-card instructions for the API from packages/contract/src/genui*.ts
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs scripts/gen-genui-prompt.mjs
gen-board-check: ## Bundle the described-card check for the API (its Describe AI draws draft cards with it)
	@node scripts/gen-board-check.mjs

.PHONY: test-mobile-live-block
test-mobile-live-block: ## Test the HTML the phone draws a doc's live blocks with in its editor page
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs --test scripts/mobile-live-block.test.mjs

.PHONY: test-dashboard
test-dashboard: ## Test the shared Report dashboard engine (card queries, layouts, built-in cards)
	@node --experimental-strip-types --test scripts/dashboard.test.mjs scripts/dashboard-files.test.mjs

.PHONY: test-mobile-clearable
test-mobile-clearable: ## Test how mobile update bodies turn null into a server-side clear
	@node --experimental-strip-types --test scripts/mobile-clearable.test.mjs

.PHONY: test-mobile-plain-text
test-mobile-plain-text: ## Test which phone sheet rows are drawn as text (model names in Settings → Agent)
	@node --experimental-strip-types --test scripts/mobile-plain-text.test.mjs

.PHONY: test-mobile-next-free-slot
test-mobile-next-free-slot: ## Test how mobile picks its next free slot from the server's free time
	@node --experimental-strip-types --test scripts/mobile-next-free-slot.test.mjs

.PHONY: test-mobile-event-occurrence
test-mobile-event-occurrence: ## Test how the phone opens, edits and ends one occurrence of a repeating event
	@node --experimental-strip-types --test scripts/mobile-event-occurrence.test.mjs

.PHONY: test-calendar-occurrence-done
test-calendar-occurrence-done: ## Test that Today and the calendar agree on which days of a repeating task are done
	@node --experimental-strip-types --test scripts/calendar-occurrence-done.test.mjs

.PHONY: test-mobile-picker-seed
test-mobile-picker-seed: ## Test when a date-time picker adopts a value that arrives while it is open
	@node --experimental-strip-types --test scripts/mobile-picker-seed.test.mjs

.PHONY: test-design-tokens
test-design-tokens: ## Test that the web CSS colours match the shared design tokens the phone uses
	@node --experimental-strip-types --test scripts/design-tokens.test.mjs

.PHONY: test-mobile-doc-jev
test-mobile-doc-jev: ## Test the mobile doc editor's property and "Link to an item" helpers
	@node --experimental-strip-types --test scripts/mobile-doc-jev.test.mjs

.PHONY: test-mobile-file-templates
test-mobile-file-templates: ## Test the mobile new doc and sheet template picker and the new-row cell-fit check
	@node --experimental-strip-types --test scripts/mobile-file-templates.test.mjs

.PHONY: test-mobile-sheet-freeze
test-mobile-sheet-freeze: ## Test how the phone fits frozen rows and columns on screen and maps touches past them
	@node --experimental-strip-types --test scripts/mobile-sheet-freeze.test.mjs

.PHONY: test-mobile-dashboard-reorder
test-mobile-dashboard-reorder: ## Test where a dragged phone Dashboard card lands and how the list makes room for it
	@node --experimental-strip-types --test scripts/mobile-dashboard-reorder.test.mjs

.PHONY: test-mobile-task-views
test-mobile-task-views: ## Test how the phone's saved views merge with the server's copy (rebase, first sync, 20-view cap)
	@node --experimental-strip-types --test scripts/mobile-task-views.test.mjs

.PHONY: test-mobile-keyboard-taps
test-mobile-keyboard-taps: ## Test that phone scrollers let a sheet's buttons work on the first tap while the keyboard is up
	@node --test scripts/mobile-keyboard-taps.test.mjs

.PHONY: test-mobile-scrollbars
test-mobile-scrollbars: ## Test that no phone scroller, editor page or Expo web page shows a scrollbar
	@node --test scripts/mobile-scrollbars.test.mjs

.PHONY: test-mobile-live-activity
test-mobile-live-activity: ## Test the phone's live notification and the quick action buttons on its notifications
	@node --experimental-strip-types --test scripts/mobile-live-activity.test.mjs

.PHONY: test-mobile-push
test-mobile-push: ## Test the phone's instant push setup and the words Settings shows for it
	@node --experimental-strip-types --test scripts/mobile-push.test.mjs

.PHONY: test-mobile-widgets
test-mobile-widgets: ## Test that every Dashboard card, custom ones included, becomes a phone home screen widget
	@node --experimental-strip-types --test scripts/mobile-widgets.test.mjs scripts/mobile-widget-render.test.mjs

.PHONY: test-mobile-widgets-native
test-mobile-widgets-native: ## Draw every phone widget with Android's real widget code (needs `make build-apk` once); PNGs in /tmp/timely-widget-test
	@scripts/mobile-widget-native/run.sh

.PHONY: test-mobile-meeting-url test-mobile-back-fallback
test-mobile-meeting-url: ## Test which Meet, Zoom and Teams links give a phone Home item its Join call button
	@node --experimental-strip-types --test scripts/mobile-meeting-url.test.mjs

test-mobile-back-fallback: ## Test where Android Back goes on every phone screen, and that only a true root leaves the app
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs --test scripts/mobile-back-fallback.test.mjs

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

test-electron-guards: ## Test the desktop shell's window-open origin policy, Bot alert payloads and where an opened alert goes
	@node --experimental-strip-types --import ./scripts/ts-siblings.mjs --test scripts/electron-guards.test.mjs scripts/notification-target.test.mjs

.PHONY: test-electron-supervisor test-mobile-server-config test-desktop-instance test-web-api-proxy test-chat-stream
test-electron-supervisor: ## Test the desktop supervisor: config/secrets, ports, Tailscale detection, backoff, stale pid, sidecar lifetime, start at login
	@node --experimental-strip-types --test scripts/electron-supervisor.test.mjs scripts/electron-lifetime.test.mjs scripts/electron-login-item.test.mjs

test-mobile-server-config: ## Test mobile pairing: QR payload parsing, server order, reachability probe
	@node --experimental-strip-types --test scripts/mobile-server-config.test.mjs

test-desktop-instance: ## Test the web Settings → Server helpers (pairing payload, status copy, MCP address) and the retry through a server restart
	@node --experimental-strip-types --test scripts/desktop-instance.test.mjs scripts/mcp-url.test.mjs scripts/api-retry.test.mjs

test-web-api-proxy: ## Test that the web /api-proxy route reaches API_ORIGIN as set at run time, not at build time
	@node --experimental-strip-types --test scripts/api-proxy.test.mjs

test-chat-stream: ## Test the web app's live chat stream: one tab holds it for the others, and it reconnects
	@node --experimental-strip-types --test scripts/chat-stream.test.mjs

.PHONY: test-agent-chat
test-agent-chat: ## Test chat on the agent engine's shared contract: streamed reply deltas and the permission words
	@node --experimental-strip-types --test scripts/agent-chat.test.mjs

.PHONY: test-agent-learning
test-agent-learning: ## Test what the agent learned, as both apps show it: the chat chip, the Keep / Discard card, budget meters and status words
	@node --experimental-strip-types --test scripts/agent-learning.test.mjs

format-qa: ## Format the 2026-10-01 QA scripts and evidence
	@pnpm exec prettier --write 'docs/qa/2026-10-01*/**/*.{mjs,json,md}'

check-qa: ## Check QA script syntax and artifact formatting
	@node --check docs/qa/2026-10-01/api-audit.mjs
	@node --check docs/qa/2026-10-01/offline-mutation-probe.mjs
	@pnpm exec prettier --check 'docs/qa/2026-10-01*/**/*.{mjs,json,md}'

##@ Agent (apps/agent)

.PHONY: hermes-sync hermes-sync-check
hermes-sync: ## Copy a Hermes Agent release into apps/agent/hermes and merge it (HERMES_REF=<vX.Y.Z>, default newest stable); report in .git/hermes-sync-report.md
	@HERMES_REF='$(HERMES_REF)' scripts/sync-hermes.sh

hermes-sync-check: ## Check apps/agent after a sync (plan 10.4 a-f, and g's agent half; CI's api job runs test-api): snapshot link, patches, conflict markers, compileall, import smoke, tool/skill policy, seams, then agent-test and agent-contract (HERMES_CHECK_STATIC_ONLY=1 skips the agent venv and the tests; HERMES_CHECK_NO_TESTS=1 skips agent-test and agent-contract)
	@scripts/hermes-sync/check.sh
	@python3 -I -B -m unittest discover -q -s scripts/hermes-sync -p 'check_test.py'
	@if [ "$(HERMES_CHECK_STATIC_ONLY)" != 1 ] && $(MAKE) -n agent-install >/dev/null 2>&1; then $(MAKE) --no-print-directory agent-install; fi
	@python3 -I -B scripts/hermes-sync/check_sync.py
	@if [ "$(HERMES_CHECK_STATIC_ONLY)" != 1 ] && [ "$(HERMES_CHECK_NO_TESTS)" != 1 ]; then $(MAKE) --no-print-directory test-agent; fi

hermes-sync-report: ## Upstream-change report between two imported Hermes tags or snapshot commits (OLD=<vX.Y.Z or commit, empty for a first import> NEW=<vX.Y.Z or commit>), to stdout
	@test -n "$(NEW)" || { echo "hermes-sync-report: set NEW=<tag or snapshot commit> (and OLD=...)"; exit 1; }
	@new=$$(scripts/hermes-sync/snapshot-of.sh '$(NEW)') && old="" && \
	if [ -n "$(OLD)" ]; then old=$$(scripts/hermes-sync/snapshot-of.sh '$(OLD)'); fi && \
	python3 -I -B scripts/hermes-sync/report.py --repo "$(CURDIR)" --old "$$old" --new "$$new" --head HEAD \
		--prefix apps/agent/hermes --sync-dir apps/agent/.hermes-sync

AGENT_DIR := apps/agent
AGENT_PYTHON_VERSION ?= 3.14.9
AGENT_VENV := $(CURDIR)/$(AGENT_DIR)/.venv
AGENT_PY = $(if $(wildcard $(AGENT_VENV)/Scripts/python.exe),$(AGENT_VENV)/Scripts/python.exe,$(AGENT_VENV)/bin/python)
AGENT_TEST_TMP ?= $(HOME)/.cache/timely-agent-test/tmp

.PHONY: agent-install agent-lint agent-test agent-contract agent-go-integration agent-go-vet-windows hermes-tools-dump hermes-skills-review hermes-sync-report lint-agent test-agent
lint-agent: ## agent-lint when the agent runtime is built, else a notice (part of make lint)
	@if [ -x "$(AGENT_PY)" ]; then $(MAKE) --no-print-directory agent-lint; else echo "lint-agent: skipped, the agent runtime is not built (make agent-install)"; fi

test-agent: ## agent-test and agent-contract when the agent runtime is built, else a notice (part of make test; plan 10.4 g)
	@if [ -x "$(AGENT_PY)" ]; then $(MAKE) --no-print-directory agent-test agent-contract; else echo "test-agent: skipped, the agent runtime is not built (make agent-install)"; fi

agent-install: ## Build the agent runtime apps/agent/.venv from Hermes' own lock (uv-managed CPython 3.14.9, extras in apps/agent/.hermes-sync/extras.txt, pytest/ruff from Hermes' dev group); only a notice when uv is missing
	@if ! command -v uv >/dev/null 2>&1; then \
		echo "agent-install: uv is not installed, so the agent runtime was not built (the classic agent still works). Install uv: https://docs.astral.sh/uv/getting-started/installation/"; \
		exit 0; \
	fi; \
	extras=$$(sed -e 's/#.*//' -e '/^[[:space:]]*$$/d' $(AGENT_DIR)/.hermes-sync/extras.txt | sed 's/^/--extra /' | tr '\n' ' '); \
	cd $(AGENT_DIR)/hermes && UV_PROJECT_ENVIRONMENT="$(AGENT_VENV)" uv sync --frozen --no-install-project \
		--managed-python --python $(AGENT_PYTHON_VERSION) --group dev $$extras

agent-lint: ## Lint Timely's agent code (apps/agent/timely_agent, tests, skills) with ruff from the agent runtime
	@test -x "$(AGENT_PY)" || { echo "agent-lint: run make agent-install first"; exit 1; }
	@cd $(AGENT_DIR) && "$(AGENT_PY)" -I -m ruff check timely_agent tests packaging $(if $(wildcard $(AGENT_DIR)/skills),skills)

agent-test: ## Test Timely's agent worker (protocol, config render, seed tree, plugins, stub-model runs); test homes under ~/.cache/timely-agent-test
	@test -x "$(AGENT_PY)" || { echo "agent-test: run make agent-install first"; exit 1; }
	@mkdir -p "$(AGENT_TEST_TMP)"
	@cd $(AGENT_DIR) && TMPDIR="$(AGENT_TEST_TMP)" "$(AGENT_PY)" -I -m pytest -q tests --ignore=tests/contract $(ARGS)

agent-contract: ## Contract tests of plan 10.4 f against real workers and a stub model, no network (ARGS=-k c19 picks tests; TIMELY_AGENT_TEST_TIMEOUT_SCALE=3 on a loaded machine)
	@test -x "$(AGENT_PY)" || { echo "agent-contract: run make agent-install first"; exit 1; }
	@mkdir -p "$(AGENT_TEST_TMP)"
	@cd $(AGENT_DIR) && TMPDIR="$(AGENT_TEST_TMP)" "$(AGENT_PY)" -I -m pytest -q tests/contract $(ARGS)

agent-go-integration: ## Go supervisor end to end with the real worker: spawn, hello, ready, run.start on a stub model, run.done, shutdown; and the agent-state backup round trip in PostgreSQL (the root .env; AGENT_REQUIRE_DB=1 fails instead of skipping without one)
	@test -x "$(AGENT_PY)" || { echo "agent-go-integration: run make agent-install first"; exit 1; }
	@cd $(API) && TIMELY_AGENT_TEST_RUNTIME=dev CHAT_TEST_ENV="$(CURDIR)/.env" TIMELY_AGENT_TEST_REQUIRE_DB="$(AGENT_REQUIRE_DB)" go test ./internal/agenthost -run TestIntegrationRealWorker -count=1 -v

agent-go-vet-windows: ## go vet the agent supervisor for Windows (Job Object, process spawning) from any OS
	@cd $(API) && GOOS=windows GOARCH=amd64 go vet ./internal/agenthost/...

.PHONY: agent-record-fixtures agent-parity
agent-record-fixtures: ## Record the worker's event fixtures for the Go engine's tests against the stub model, no network (OUT=<dir>, required; ONLY=<scenario>,... picks some)
	@test -x "$(AGENT_PY)" || { echo "agent-record-fixtures: run make agent-install first"; exit 1; }
	@if [ -z "$(OUT)" ]; then echo "$(RED)Usage: make agent-record-fixtures OUT=<dir> [ONLY=<scenario>,...]$(RESET)"; exit 1; fi
	@mkdir -p "$(AGENT_TEST_TMP)"
	@TMPDIR="$(AGENT_TEST_TMP)" "$(AGENT_PY)" -I $(AGENT_DIR)/tests/record_events.py --out "$(OUT)" $(if $(ONLY),--only "$(ONLY)")

agent-parity: ## Run the agent QA scenarios on classic, the agent engine or both against a running API (ENGINE=classic|agent|both PROVIDER=<id> MODEL=<id> SCENARIOS=<file> OUT=<dir> [ONLY=<ids>]; TIMELY_API, default :8081; the key only from TIMELY_PARITY_KEY exported in your shell, never .env)
	@case "$(origin TIMELY_PARITY_KEY)" in file|override|command\ line) echo "$(RED)agent-parity: export TIMELY_PARITY_KEY in your shell; it is never read from .env or the command line$(RESET)"; exit 1;; esac
	@case "$(ENGINE)" in classic|agent|both) ;; *) echo "$(RED)agent-parity: ENGINE must be classic, agent or both$(RESET)"; exit 1;; esac
	@if [ -z "$(PROVIDER)" ] || [ -z "$(MODEL)" ] || [ -z "$(SCENARIOS)" ] || [ -z "$(OUT)" ]; then \
		echo "$(RED)Usage: make agent-parity ENGINE=classic|agent|both PROVIDER=<id> MODEL=<id> SCENARIOS=<file> OUT=<dir> [ONLY=<ids>]$(RESET)"; exit 1; fi
	@case "$(PROVIDER)" in claude|codex) ;; *) test -n "$$TIMELY_PARITY_KEY" || { echo "$(RED)agent-parity: export TIMELY_PARITY_KEY in your shell first (claude and codex need none)$(RESET)"; exit 1; };; esac
	@cd $(API) && TIMELY_API=$${TIMELY_API:-http://localhost:8081} go run ./scripts/agentqa -engine "$(ENGINE)" -provider "$(PROVIDER)" -model "$(MODEL)" \
		-scenarios "$(abspath $(SCENARIOS))" -out "$(abspath $(OUT))" $(if $(ONLY),-only "$(ONLY)")

hermes-tools-dump: ## Regenerate apps/agent/.hermes-sync/{tools,skills,seams}.json and skill-body.yaml's tool names from the agent runtime
	@python3 -I -B scripts/hermes-sync/check_sync.py --write

hermes-skills-review: ## Record reviewed skill trees in skills-reviewed.json after reading them (NAME=<skill or folder>, or ALL=1)
	@if [ "$(ALL)" = 1 ]; then python3 -I -B scripts/hermes-sync/check_sync.py --review-all; \
	elif [ -n "$(NAME)" ]; then python3 -I -B scripts/hermes-sync/check_sync.py --review-skills $(NAME); \
	else echo "hermes-skills-review: set NAME=<skill or folder> or ALL=1"; exit 1; fi

##@ Agent runtime packaging (plan 11.4, 11.5)

.PHONY: stage-agent smoke-agent agent-python-licenses test-stage-agent clean-agent-stage docker-api docker-agent-smoke
stage-agent: ## Stage the agent runtime for this host into apps/web/.electron-agent/<os>-<arch> (CPython from Hermes' pm/lock.json, uv.lock + extras, shipped skills, compileall, ship checks, THIRD_PARTY_LICENSES, MANIFEST.json); needs uv
	@node $(WEB)/electron/stage-agent.mjs

smoke-agent: ## Smoke-test a staged agent runtime: boot.py usage, prepare, then the Go real worker on its stub model (AGENT_ROOT=<agent dir>, default the host stage; READ_ONLY=1 makes it read-only and fails on any write into it)
	@node $(WEB)/electron/smoke-agent.mjs $(if $(AGENT_ROOT),--root "$(AGENT_ROOT)") $(if $(filter 1,$(READ_ONLY)),--read-only)

agent-python-licenses: ## Record the licences of the libraries built into the shipped interpreter (OpenSSL, libffi, SQLite, ...) for every desktop target from python-build-standalone's full archives, into apps/agent/packaging/python-licenses/<version>/; run after a Hermes sync moves the Python pin (downloads about 110 MB per target, deleted afterwards; needs tar with zstd)
	@node $(WEB)/electron/python-licenses.mjs

test-stage-agent: ## Test the agent staging helpers: lock pins, extras, host check, shipped skills, tree checks, licences, read-only diff, the boot.py shim
	@node --test scripts/stage-agent.test.mjs

clean-agent-stage: ## Delete staged agent runtimes (apps/web/.electron-agent) and their scratch folders; the interpreter download cache stays
	@node $(WEB)/electron/stage-agent.mjs --clean

docker-api: ## Build the API Docker image (Debian slim with the agent runtime) as timely-api:local
	docker build -f $(API)/Dockerfile -t timely-api:local .

docker-agent-smoke: ## Build the API image and smoke-test its agent runtime read-only, as uid 10001, with a throwaway Postgres (removes what it creates)
	@bash scripts/docker-agent-smoke.sh
