# In-app AI agent

Design confirmed for implementation on 2026-09-28. The requirements below were
accepted during the interview, including sheet creation and editing.

## Accepted requirements

- First release targets web and desktop.
- Natural-language requests can create related objects, write document content,
  and update existing data, including a recurring Event's weekdays.
- Clear single-object creation requests execute immediately. Multi-step requests
  produce one editable proposal before applying. Ask follow-up questions when
  missing information would materially change the result.
- Use OpenRouter with `z-ai/glm-5.3-flash`, verified against its
  [official model page](https://openrouter.ai/z-ai/glm-5.3-flash).
- Use one server-configured OpenRouter key initially. Conversations and operations
  are scoped to the signed-in account.
- Support creation and editing of everyday Timely objects, including documents
  and sheets. Include Auto-schedule through its existing Preview/Apply flow.
  Exclude whole-object deletion, settings changes, backups, and restore initially.
  Explicitly requested sheet-content removal is the exception below.
- Sheet creation and editing through natural language are explicit first-release
  requirements, not optional follow-up work. Support populated sheet creation,
  adding and editing rows and columns, updating cells, and writing formulas
  supported by Timely. Clear single-cell edits execute immediately; populated
  sheet creation and bulk changes require an Agent proposal.
- Explicitly requested row/column removal and sheet-data replacement require a
  preview of what will be lost and approval. Deleting an entire sheet remains
  out of scope.
- Clear small edits execute immediately. Recurring-series changes, bulk edits,
  and replacement of existing document content require a preview and approval.
- An unambiguous visible workspace/project can supply the destination. State
  that destination; ask when multiple matches are plausible.
- Web search defaults off for every new chat. Remember its toggle within that
  conversation. When enabled, search when useful and include source links in
  answers and research-based documents.
- Add a Chat tab in the sidebar with saved conversation history. A keyboard
  shortcut opens a new chat over the current screen with that screen's context.
  Start with typed input.
- If an approved multi-step operation partially fails, preserve successful
  creations, show unfinished steps, and retry without duplicating successes.
- Recurring edits default to future occurrences. Preserve past meetings and
  individually adjusted occurrences; show the effective date in the proposal.
  Ask which meeting when multiple match.
- Overlay chats attach the current location, open object, and selected text/date
  range where applicable, shown as removable context chips. The attached context
  remains fixed when navigating; fetch current object data as needed.
- Proposals use readable change cards, conversational revisions, and one Apply
  button. If underlying data changes before Apply, refresh affected changes and
  request approval again.
- For the Japanese-learning example, propose three unscheduled Work items with
  30-minute estimates and ask for the Reminder date/time. Place sessions on the
  calendar only when requested.
- Runs continue on the server when navigating away or closing the overlay, with
  progress and results saved to conversation history. Stop prevents further steps;
  completed changes remain.
- Notify the person when a run finishes or is waiting for approval through
  persistent in-app notifications and a Chat unread badge, linking directly to
  the relevant conversation. Electron additionally shows a native desktop
  notification while running but unfocused. Alerts after fully quitting the app
  are deferred.

## User examples

- “Create a workspace for learning Japanese, add three study sessions, and remind
  me to register for the exam.”
- “Create a project for creating a PDF tool like pdf guru and make a doc with
  initial plan for making the project.”
- “Change the days to monday and tuesday for the reccuring standup meeting.”

## Existing foundations

The API exposes authenticated MCP tools for creation, editing, recurrence, and
Markdown document content (`apps/api/internal/features/agent/`). An embedded
conversation runtime has not been found. OpenRouter currently supplies embeddings
(`apps/api/internal/features/embed/`), rather than conversational execution.

Existing MCP instructions require an explicit workspace in the current request
for Work creation. The accepted in-app behavior allows unambiguous visible page
context, so this difference must be handled explicitly during implementation.
Existing Placement and Event-time ADRs continue to apply. Recurrence tools support
whole-series updates, individual occurrence time changes, and series splits for
this-and-future edits.

## Implementation constraints from the repository

- Sheet formulas use Timely's limited evaluator, not full Excel compatibility.
  Existing structural operations do not rewrite positional formula references;
  column type changes can clear incompatible values. Implementation must account
  for formula impacts and data loss in proposals, including changes labeled as
  edits. Dedicated cell tools target the primary tab, so other-tab edits need
  explicit targeting without overwriting unrelated data.
- Reuse account-scoped domain services and preserve Placement ownership of Block
  writes. Expose only the agent's accepted operation scope, not every MCP tool.
- Reconcile the in-app destination-context policy with external MCP instructions
  explicitly rather than silently relying on contradictory instructions.
- Existing notifications need conversation targets. Web push and Electron native
  notification delivery are not currently implemented; only the latter is in scope.
- The existing background worker processes jobs serially. Long model calls must
  not block reminders, indexing, or backups. Agent runs need persisted execution
  state and safe retry handling beyond generic whole-job retries.
- Recurrence splits must retain individually adjusted occurrences under the
  accepted future-only behavior; tool availability alone does not establish that
  this guarantee is already implemented.

## Acceptance scenarios

- Sheets: create a project budget with Item, Quantity, Unit price, and Total
  columns; append supplied expenses; change a clearly identified hosting cost
  to $25; add supported formulas calculating row totals. Preview populated
  creation and bulk changes. Preview data loss before removal or replacement,
  and apply existing stale-proposal and safe-retry requirements.
- Japanese study: propose a workspace and three unscheduled 30-minute Work items,
  ask for the Reminder date/time, and apply the reviewed changes once approved.
- PDF-tool project: propose the project and a linked planning document with actual
  drafted content. When search is enabled and used, include source links.
- Standup change: resolve the intended meeting, preview Monday/Tuesday recurrence
  from an explicit effective date, and preserve past and adjusted occurrences.
- Contextual chat: the shortcut opens a new overlay chat with removable context
  chips; navigation does not replace its attached context, and it appears in history.
- Stale proposal: changes to affected data before Apply cause a refreshed proposal
  requiring renewed approval.
- Partial completion: failures and retries preserve successful writes without
  duplicates; Stop prevents further steps without undoing completed writes.
- Background completion: leaving the chat does not cancel the run; results and
  approval requests appear in history and notifications with conversation links.

## Final review

The user authorized implementation of the consolidated design, including sheets. Implementation details such as the shortcut binding,
search integration, and run storage schema must satisfy these requirements and
can be selected during implementation.


## Implementation

- Existing Hermes MCP handlers are reused through an in-process catalog. The
  in-app allowlist excludes unrelated administrative and destructive tools.
- PostgreSQL stores conversation history, pending proposals, read snapshots,
  execution progress, and worker leases. Each domain write and completed-step
  checkpoint commit in one transaction; retries skip committed steps.
- A dedicated worker pool handles model calls independently of reminder jobs.
  Proposals are checked against input schemas and current data before execution.
- Chat lives at `/chat`; Ctrl/Cmd+Shift+J opens a new contextual overlay and
  G then A navigates to Chat. Web search is per conversation and defaults off.
- OpenRouter's web plugin runs only for explicit model search-tool calls when
  enabled, using a public query rather than the private conversation as the
  search request. See the [provider documentation](https://openrouter.ai/docs/guides/features/plugins/web-search).
- Electron uses native notifications while running and unfocused, with a click
  opening the matching conversation. OS notification permissions still apply.

## Verification commands

Run from the repository root:

- `make test-api` and `make lint-api`
- `make test-chat-integration` — temporary PostgreSQL schemas using API `.env`,
  covering actual migrations, shared domain tools, rollback, safe retries,
  recurrence exceptions, stale proposals, and account isolation.
- `make typecheck-web`, `make lint-chat`, and `make build-web`
- `make audit-chat` — browser checks against mocked API responses with the web
  server on 4002; set `CHAT_BROWSER` to an existing Chromium executable if needed.

## Verified implementation

- Live OpenRouter checks created a workspace, project, and linked planning doc;
  created a populated budget sheet after approval; then edited one cell through
  chat while preserving its formula. The dedicated test account was removed.
- API unit/integration tests, API lint, web/Electron type checks, focused chat
  lint, and the production web build pass.
- Chromium checks pass for history, proposal review, Apply revision binding,
  search persistence, contextual overlay, removable chips, and light/dark layouts.
- Full web lint still reports existing errors outside this feature. Electron
  notification delivery is implemented and type-checked; native OS delivery
  requires checking in a running Electron session.

### Timeout and reusable-template follow-up

- Provider body timeouts are reproduced by a deterministic HTTP regression test.
  Model calls have a four-minute limit and one transient retry within the run's
  ten-minute deadline. Heartbeats retain the lease and cancel the request after Stop.
- Chat now exposes the shared create/rename sheet-template tools. Deprecated
  description inputs are excluded from inferred schemas; repeated grid replacements
  in one proposal are rejected before approval.
- Historical proposals are explicitly marked inactive in model context; revisions
  must submit a new proposal before referring to Apply.
- Live testing reached review with web research, and a fresh monthly-expense
  template request completed Apply with its rows and SUM formula preserved. Provider
  latency remains variable; this change does not guarantee an immediate response.

## Image attachments and receipts

The user confirmed the image/receipt design after the interview. Web and desktop
Chat accept file selection, drag-and-drop and clipboard paste: up to five JPEG/PNG
photos of one receipt per message, 10 MB and 20 megapixels per image. General
images are also supported; an image without an instruction is described and the
assistant asks what to do unless it is a recognizable receipt.

Receipt extraction always includes individual items. An editable review pairs the
image with merchant, date, currency, category, printed subtotal/tax/tip/discount,
total, and item descriptions/quantities/unit prices/amounts. Unknown values remain
unknown. Uncertainties must be reviewed; missing required values and inconsistent
arithmetic block proposals. Money reconciliation uses decimal rational arithmetic.
Natural-language corrections revise the draft without writing to sheets.

The person chooses an existing expense sheet and summary tab, or a new sheet in a
workspace. Receipt proposals reuse the shared Hermes create/update sheet handlers.
One summary row goes in the expense tab and each item goes in Items, linked by a
receipt ID. Missing columns and tabs are included in the proposal. Existing rows,
formulas and unrelated tabs are retained; currency is preserved and never converted
or summed across currencies. Updating a duplicate preserves row positions, clearing
surplus imported item cells rather than shifting unrelated formula references.

Likely duplicates compare merchant, date, original currency, total and, when linked
items are available, item descriptions/amounts. The person can skip, update a chosen
matching entry, or add anyway. Receipt writes always require Apply. Editing a draft
blocks Apply until its proposal is rebuilt. Concurrent sheet changes trigger a fresh
receipt proposal and renewed approval; committed create steps are not repeated.

Images are temporary, account-scoped files outside the database. Uploads are decoded
and re-encoded to remove embedded metadata; only attachment metadata and extracted
text/receipt data enter chat storage. Images are served through authenticated,
no-store routes and removed when the person confirms, discards, or after 24 hours.
A startup/periodic sweep handles abandoned files. An expired image needs re-uploading
to re-read it, while its extracted draft remains available. Images are removed at
confirmation even if a later sheet write fails; retries use the reviewed draft.

Vision and subsequent private-image conversation requests enforce OpenRouter
`provider.zdr=true`, with no non-ZDR fallback. Image conversations cannot invoke web
search. This is a provider routing policy, not a claim that deleting Timely's copy
recalls transmitted data. See [OpenRouter ZDR](https://openrouter.ai/docs/guides/features/zdr).

Verification includes provider payload/privacy tests, account isolation, image
confirmation/expiry deletion, decimal reconciliation, duplicate detection, preservation
of sheet content and stale-proposal refresh. `make audit-chat` covers image upload,
image-only send, receipt editing, Apply invalidation and removal of image previews.
A live synthetic receipt passed GLM 5.3 Flash vision through the ZDR route, then saved
one Expenses row and two Items rows and removed the image on confirmation.

Receipt photo verification (2026-09-29): tested the supplied AEON Japanese receipt
through live image upload, extraction, review, approval and sheet creation in a
throwaway account. The test exposed double subtraction of an item discount.
`discountIncluded` now records whether the printed discount is already reflected
in item amounts/subtotal, is editable during review, and is preserved in Expenses.
Discount lines are folded into their purchased item's net amount rather than
becoming extra purchased items. Verified two item rows (140 and 88 JPY), subtotal
228, discount 60 already included, tax 18, total 246, and date 2019-11-09.
Confirmation removed the uploaded image file and subsequent retrieval returned 410.
Regression coverage checks both included and additional discounts.

Receipt destination defaults (2026-09-29): review preselects the attached open
sheet and active non-Items tab. Otherwise it selects a unique expense-named sheet
in the attached project or workspace; ambiguous matches stay unselected. The
summary tab falls back to Expenses, then the first non-Items tab. Manual choices
and saved review destinations take precedence. Context includes a removable active
sheet-tab chip and the open project's identity. Browser coverage checks defaults,
workspace ambiguity, project scoping, manual overrides and submitted tab IDs.

Standalone receipt-chat follow-up: without attached project/workspace context,
a single non-archived expense-named sheet anywhere in the account is now
preselected (including singular “Expense”). Attached scope and manual choices
still take precedence; multiple candidates remain unselected. Browser regression
reproduced the blank default before the fix and covers both scoped and unscoped
ambiguity. Empty item lists now explain that a totals-only or unreadable photo
provides no item details, that Japanese is supported, and that the current import
requires manually supplied items or an itemized receipt. No items are fabricated.

Summary-only receipts: when no individual items are available, review and Apply
now save a single linked Items row using the merchant name, original currency,
and full receipt total. The raw draft retains its empty item list so tax/tips/
discounts are not added to that aggregate amount a second time. Printed receipt
fields remain in Expenses; known subtotal arithmetic is still validated. Existing
itemized receipts retain their items. This supersedes the earlier requirement to
manually supply items for totals-only receipts. Integration coverage verifies
proposal, Apply, stored rows, and duplicate detection.

Receipt row placement: sheets allocate 20 blank rows by default. Imports now reuse
trailing empty rows after the last occupied row instead of appending after that
padding. Both Expenses and Items preserve existing row IDs and formatting, internal
blank gaps, formulas, notes, links and merged ranges. Proposals name the destination
summary row. Existing receipts and duplicate updates keep their current positions.
Regression coverage reproduces a four-row expense grid receiving its first receipt
on row 21, then verifies placement on row 5 and successful Apply/duplicate detection.
