# design-sync notes (Timely web app -> claude.ai/design)

Target project: "Timely Design System" (projectId in config.json). Shape: package, no Storybook.

## How the "package" is made
- Timely has no component library package: the components live inside the Next.js app
  (`apps/web/app/_components`). `.design-sync/pkg/` is a wrapper package (`@timely/ui`,
  global `window.Timely`) whose `index.ts` barrel re-exports them. **Add a barrel line when a
  new component lands** - nothing is auto-discovered.
- `cfg.buildCmd` (`node .design-sync/pkg/build.mjs`) must run before the converter: it emits
  `.d.ts` via tsc (rewriting `@/` and `@timely/contract` aliases to relative paths, because
  ts-morph ignores tsconfig paths), and compiles Tailwind 4 (`.design-sync/pkg/tailwind.css` ->
  `dist/timely.css`, the `cssEntry`). Tailwind CLI lives in `.ds-sync/node_modules`
  (`npm i @tailwindcss/cli@4.3.3` there, matching the app's tailwindcss version).
- Converter invocation (repo root):
  `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules apps/web/node_modules --entry .design-sync/pkg/index.ts --out ./ds-bundle`
- `.design-sync/pkg/node_modules` is a symlink to `apps/web/node_modules` (created by build.mjs,
  gitignored) so tsc/esbuild resolve the app's deps from the wrapper.
- `tsconfig.bundle.json` (`cfg.tsconfig`) maps `@/*` and swaps `next/navigation`, `next/link`,
  `next/image` for `pkg/shims/*` (no Next router outside the app). `tsconfig.json` is only for
  the declaration emit and must list the app's ambient `.d.ts` files (view-transitions,
  electron-env, lucide-icon-modules) or tsc fails.
- `pkg/shims/env.ts` (first barrel import): defines `process.env` (client.ts reads
  `NEXT_PUBLIC_API_URL` at module scope) and polyfills `React.ViewTransition` as a pass-through -
  the app imports it from Next's React canary; stable react@19.2.4 lacks it and every overlay
  would throw "Element type is invalid".
- Fonts: `next/font/google` can't be scraped. `.design-sync/fonts/` holds Inter, JetBrains Mono
  (app) and Bricolage Grotesque (landing display) woff2 + `fonts.css` (`cfg.extraFonts`);
  `tailwind.css` maps the next/font CSS vars (`--font-geist-sans` etc.) to those families.
- `TimelyProvider` (`pkg/provider.tsx`, `cfg.provider`): React Query client, MotionConfig,
  light/dark token scope (adds `dark` to `<html>` too, because dialogs/menus portal to body),
  and an in-browser mock of the Timely API (`pkg/mockApi.ts`) serving `pkg/sample.ts` - so
  data-bound components render populated. Previews get `animations: false`.

## Capture / grading gotchas
- package-capture freezes the page clock (2024-05-15T12:00Z): motion entrance animations
  never progress, so cards rendered at opacity 0. Fixed via `TimelyProvider animations={false}`
  (MotionGlobalConfig.skipAnimations) in `cfg.provider.props`. Sample data is computed relative
  to `new Date()`, so in captures "today" is 2024-05-15.
- Playwright must match the cached chromium build (`~/.cache/ms-playwright/chromium-1234` ->
  playwright@1.62.1 in `.ds-sync/`). The repo's own playwright 1.63 pins 1243.
- Overlays (fixed-position dialogs) need `overrides.<Name>: {cardMode: "single", viewport}`.

## Known render warns
- `[FONT_MISSING] "Geist", "Geist Mono", "Cascadia Code", "Fira Code"`: fallback entries in
  font stacks only (primary families Inter/JetBrains Mono ship). Accepted.
- `[TOKENS_MISSING] --tw, --accent-chroma, --accent-hue`: `--tw*` is Tailwind-internal;
  accent vars are set at runtime by `html.theme-custom` (custom accent), unused by default.
- `[RENDER_THIN] AccountSettings variants render identically`: false positive - the cells differ
  (form vs Devices section scrolled in via the async scrollTo helper).
- "inlined npm packages: 1": the converter's metafile regex sees pnpm's `.pnpm` dir as one
  package. Cosmetic.

## Preview authoring
- Size preview containers with inline `style={{ width, height }}`. Arbitrary Tailwind sizes
  (`w-[1100px]`) only exist if some app source or preview already used them at the last
  `pkg/build.mjs` run (previews are an `@source`, so a full rebuild picks them up - but a
  subagent's targeted rebuild doesn't).
- Mock API handlers can return JSON, a `Blob`, or a `Response`. Chat attachments use
  `GET /chats/images/:id` -> SVG blob (`pkg/sample/image.ts`).
- Sample workspace (`pkg/sample.ts` + `pkg/sample/*`, typed against the app's types): user
  "Maya Chen", workspaces Design Studio / Personal, projects Onboarding Redesign (4 stages),
  Design System v2, Portfolio Refresh; 23 tasks, 12 events, 4 docs, 2 sheets, 3 chats. Shapes
  follow the Go handlers (e.g. workspace labels field is spelled `lables`). `/docs/:id/watch`
  is an EventSource (not mockable via fetch) - harmless 404 retries in previews.
- Calendar previews build `CalendarEvent`s by hand (`toCalendarEvents` isn't exported).
  CodeBlockView needs a fake `node` + contentDOM HTML injected from an effect (the editor
  normally mounts it).
- Skipped interaction-only states (record new ones here): TimeGrid drag/resize, hover states,
  ChangeCards expanded review details, MessageList archive row expanded, Select open panel.
- Landing (`landing/**`): wrap light-theme cells in `<div data-landing-theme="light">` (the
  `.landing` root is dark by default); `html:has(.landing)` paints the card page dark - expected.
  ThemeToggle/LandingHeader always capture light (headless prefers light). Scene primitives
  (MiniWindow, SceneButton, Typed, Caret, CountUp, MiniWeek, EventBlocks) need an `eager`
  SceneBox around them (`--u` sizing). `hueStyle` isn't exported - set `--hue` inline.
  Landing lg/xl layouts need wide viewports (overrides in config: LandingSection, LandingHeader,
  LoopNav, FeatureIndex). Media queries follow the capture viewport, not the cell.
- Animated scenes step on real setTimeouts; `animations={false}` also forces
  `prefers-reduced-motion: reduce` (matchMedia proxy in provider.tsx), which is the app's own
  finished-frame path for `useScene`/`CountUp`. Changing provider behaviour does NOT re-key
  grades (only the .tsx + preview config do) - delete affected `.cache/review/*.grade.json`
  by hand after such a change.
- App finding (not a sync bug): in the light landing theme EventBlocks' `color-mix(... var(--card))`
  turns pink because `--card` is hueless white.
- Skipped states: SceneButton press, QuickStart "Copied", l-button/l-ghost hover.
- Card cells are a containing block for `position: fixed` (wrapper transform): non-portaled
  fixed overlays (EntityModalShell, ToastHost) position against the cell; previews wrap them in a
  sized `transform: translateZ(0)` frame. Portaled overlays are unaffected.
- Store-driven hosts (ToastHost, ConfirmHost, ContextMenuHost) share zustand state across all
  cells of a page -> `cardMode: single`.
- Capture browser TZ isn't UTC: datetime props as local `YYYY-MM-DDTHH:mm` (no `Z`).
- Popover-open states are opened by clicking the trigger in a mount effect.
  ExpandCollapsedListButton renders only when collapsed (cell seeds localStorage).
  KeyboardShortcuts renders null - its card is a legend of its bindings.
- Skipped: context-menu submenu flyouts (hover), group-panel drag-reorder.
- **Per-cell data: use `seed`, never a nested `api`.** `installMockApi` is page-global (fetch
  is shared), so a nested `<TimelyProvider api>` leaks into every other cell. `seed` is per
  provider (own QueryClient), e.g. `seed={[[["tasks"], []]]}`. Loading states skipped (a
  never-resolving handler would hang the page's queries).
- Prop-fed components (KanbanView, GanttView, BulkActionBar, TaskExecution, TaskScheduleSection,
  ProjectTaskList) get props by calling `sampleApi()` handlers directly, so props match the API.
- Review sheets clip cells at ~650px even for column cards: verify wide components (tables,
  boards, WeekView) against the validate screenshot `_screenshots/<group>__<Name>.png` too.
- WeekView needs `viewport: 1280x720`; MonthView previews are 860px wide to fit the column card.
- Composer/MessageList image cells use `img_whiteboard`; the chat carries `images: ChatImage[]`
  and messages reference them via `imageIds`.
- App finding (not a sync bug): Kanban grouped by stage titles every column "Untitled" -
  kanbanView reads `row.project.stages`, but GET /tasks preloads only `Project`
  (apps/api task/repository.go). KanbanView preview enriches rows from GET /projects.
- Skipped: BulkActionBar empty selection (renders null), window.confirm deletes, all drag
  interactions, EntityDetailPanel delete-confirm/loading.
- Schedule dialogs: the sample has no `/schedule/preview|apply|undo` routes, so
  AutoScheduleDialog/AutoScheduleIndicator cells pass the same `api` object in every cell
  (handler keys off request `taskIds`, so cells don't collide). Indicator Running cell uses a
  never-resolving apply; Placed/Failed auto-dismiss after 4.5s real time (slow capture could
  miss them). Improvement: add default schedule routes to sample.ts and drop the per-card api.
- EventDialog maps `GET /calendar` entries by hand (`toCalendarEvents` not exported).
  SearchModal cells open via the app's own Ctrl+K listener; AddItemModal opens via the
  palette's "Create ..." actions (`useSidebarStore`/`useScheduleActivityStore` aren't exported,
  so workspace mode isn't reachable).
- TodayDashboard/WaitingForSlotRail use cell-local seeds (`["today",""]`, `["tasks","inbox"]`,
  `["schedule","rank"]`). Skipped: loading/error cells for these.
- Settings previews sit in a copy of the Settings page frame (880x680, fits the default
  viewport); a `scrollTo="<heading>"` helper prop in each preview scrolls to lower sections.
  Inline editors (CreateLabelInline, CreateCustomFieldInline) render inside ModalSidebar.
- AppearanceSettings has one cell: `usePreferences()` reads PreferencesContext, which only the
  app's ClientRuntime provides (not exported), so theme/accent/auto-hide states are unreachable.
  Exporting a preferences provider from apps/web would unlock them.
- ApiKeysSettings KeyJustCreated POSTs to the shared sample store (delayed 400ms); a later
  refetch in another cell would show the new key.
- Capture TZ here was Asia/Tokyo; timezone selects show the browser zone (expected).
- App findings: NamedColorEditor placeholder reads "New statuse name"; AgentSettings
  "Use as default" wraps at 880px.
- Skipped: ColorPicker popover inside editors, revoke confirm, restore file picker,
  ModelPicker "Use this name".
- `cfg.dtsPropsFor.Sidebar`: the extractor invented `{name, icon, href}` for the prop-less
  Sidebar; pinned to an empty contract with a comment. Re-check after DS changes.
- SheetGrid previews copy the sheet page's dark `KINETIC_THEME` token scope. Data-bound props
  (stages, sheet tabs, doc content) are loaded in previews via `fetch("/api-proxy/...")`.
- ReceiptReview / Conversation ReceiptInReview pass an additive `api` with ids nothing else uses
  (`GET /chats/chat_receipt`, `GET /chats/images/img_bb_receipt`); every provider in those files
  passes the same object. Needed because `useChat` polls every 5s (a seed-only chat would 404).
  ReceiptReview's lg two-column layout isn't captured (900px viewport) - cards show the narrow
  chat-overlay layout.
- `useParams` shim returns `{}`, so DocList/SheetList never highlight an open item.
- App finding: Sidebar's active highlight pill (`-z-10`, no stacking context) is hidden behind
  the rail background; only the icon colour marks the active item. Previews match the app.
- Sample gaps: no receipt image, no chat with an image review, no sheet titled "expense".
- Skipped: loading cells, drag-reorder, hover-only row actions, sheet cell editing, editor
  slash/mention/floating-toolbar menus.

## Re-sync risks (watch-list for the next run)
- **Barrel drift**: new/renamed components in apps/web/app/_components are invisible until a
  line is added to `.design-sync/pkg/index.ts` (+ a preview). Renames there regroup cards.
- **Sample data vs API**: `pkg/sample*` mirrors Go handler shapes as of 2026-10-03. API/type
  changes in apps/web/app/utils/api or _types break data-bound previews silently (empty or
  error states) - tsc on build.mjs catches type drift, not semantic drift. Re-check the
  data-heavy cards (TodayDashboard, TasksTable, KanbanView, settings panels) on API changes.
- **Next/React canary gaps**: shims for next/navigation|link|image and the React.ViewTransition
  pass-through (pkg/shims). A new Next-only API or canary React export used by components
  needs a shim, or every card using it breaks.
- **Fonts** are pinned copies in `.design-sync/fonts/` (Inter, JetBrains Mono, Bricolage
  Grotesque). If layout.tsx/page.tsx change next/font families, refetch and update.
- **Tailwind** CLI version in `.ds-sync` must match the app's tailwindcss (4.3.3 now).
- **Playwright** must match the cached chromium (`~/.cache/ms-playwright/chromium-1234` ->
  playwright@1.62.1); a cache refresh changes that.
- **Provider behaviour isn't in the grade key**: changes to provider.tsx/mockApi.ts/sample.ts
  don't re-key grades. After such a change, delete the affected `.cache/review/*.grade.json`
  (or capture with `--force`) and regrade.
- Previews that pass a page-global `api` (AutoScheduleDialog/Indicator, ReceiptReview,
  Conversation) depend on route ids nothing else uses; keep them unique.
- The design agent's README advertises `animations={false}` in the provider example (from
  cfg.provider props); conventions.md says it's for static screenshots only.
